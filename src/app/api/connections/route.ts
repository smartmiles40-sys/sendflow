import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { criarInstancia, EvolutionError, evolutionConfigurada } from '@/lib/whatsapp/evolution';
import { chamar, CloudError, esquecerToken, lerSaudeDoNumero } from '@/lib/whatsapp/cloud';
import { cloudConfigurada } from '@/lib/whatsapp/meta-config';
import { apontarWebhookDoNumero } from '@/lib/whatsapp/meta-conexao';
import { nomeDeInstancia, urlDoWebhook } from '@/lib/whatsapp/conexao';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .order('criado_em', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    conexoes: data ?? [],
    configurada: evolutionConfigurada(),
    // A tela precisa saber quais dos dois conectores estão prontos para poder explicar
    // o que falta em vez de deixar o botão falhar.
    oficial: await cloudConfigurada(),
  });
}

/**
 * Cria a conexão. São dois caminhos, porque são dois conectores:
 *
 *   • `provider = 'evolution'` — registra a instância na Evolution (já apontando o
 *     webhook para cá) e devolve o primeiro QR Code para a tela mostrar na hora.
 *   • `provider = 'cloud'` — não há QR. O número já existe no Business Manager da
 *     Meta; o que se faz aqui é CONFERIR se o token enxerga aquele `phone_number_id`
 *     e guardar a linha. Conferir na criação evita o erro clássico: cadastrar um id
 *     errado e só descobrir na primeira campanha, com 20 mil linhas na fila.
 */
export async function POST(req: Request) {
  const parsed = await readJson<{
    nome?: unknown;
    provider?: unknown;
    phone_number_id?: unknown;
    waba_id?: unknown;
    token?: unknown;
    msgs_por_segundo?: unknown;
    delay_min_seg?: unknown;
    delay_max_seg?: unknown;
    limite_diario?: unknown;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const nome = String(body.nome ?? '').trim();
  if (!nome) {
    return NextResponse.json({ errors: [{ field: 'nome', message: 'Dê um nome à conexão.' }] }, { status: 400 });
  }

  if (body.provider === 'cloud') return criarConexaoOficial(nome, body);

  if (!evolutionConfigurada()) {
    return NextResponse.json(
      { error: 'Evolution API não configurada. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY.' },
      { status: 503 },
    );
  }

  const delayMin = Number(body.delay_min_seg ?? 8);
  const delayMax = Number(body.delay_max_seg ?? 15);
  if (!Number.isInteger(delayMin) || !Number.isInteger(delayMax) || delayMin < 1 || delayMax < delayMin) {
    return NextResponse.json(
      { errors: [{ field: 'delay_min_seg', message: 'Intervalo inválido: o mínimo precisa ser ≥ 1s e ≤ o máximo.' }] },
      { status: 400 },
    );
  }

  const instanceName = nomeDeInstancia(nome);
  const webhookUrl = urlDoWebhook();

  let qrcode;
  try {
    qrcode = await criarInstancia(instanceName, webhookUrl);
  } catch (e) {
    const erro = e instanceof EvolutionError ? e : new EvolutionError(String(e));
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('connections')
    .insert({
      nome,
      instance_name: instanceName,
      status: 'conectando',
      delay_min_seg: delayMin,
      delay_max_seg: delayMax,
      limite_diario: Number.isInteger(Number(body.limite_diario)) ? Number(body.limite_diario) : 500,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ conexao: data as Connection, qrcode }, { status: 201 });
}

/**
 * Cadastra um número da API oficial.
 *
 * O token colado aqui vai direto para o Vault (o mesmo cofre do botão da Meta) e o
 * webhook do número é apontado para o SendFlow na hora — igual ao botão, só que com os
 * IDs e o token copiados do Business Manager.
 *
 * O teto diário vem em branco de propósito: quem manda no volume aqui é o tier do
 * número na Meta, e inventar um limite de 500 (que é o do chip) seria estrangular
 * justamente o canal que existe para volume.
 */
async function criarConexaoOficial(
  nome: string,
  body: {
    phone_number_id?: unknown;
    waba_id?: unknown;
    token?: unknown;
    msgs_por_segundo?: unknown;
    limite_diario?: unknown;
  },
) {
  const token = String(body.token ?? '').trim();
  if (!token && !(process.env.META_ACCESS_TOKEN ?? '').trim()) {
    return NextResponse.json(
      { errors: [{ field: 'token', message: 'Cole o token de acesso do número (o permanente, do usuário do sistema).' }] },
      { status: 400 },
    );
  }
  if (token && (token.length < 20 || /\s/.test(token))) {
    return NextResponse.json(
      { errors: [{ field: 'token', message: 'Esse token não parece completo — copie de novo, sem espaços.' }] },
      { status: 400 },
    );
  }
  const wabaId = String(body.waba_id ?? '').trim();
  if (wabaId && !/^\d{5,}$/.test(wabaId)) {
    return NextResponse.json(
      { errors: [{ field: 'waba_id', message: 'O ID da conta (WABA ID) é só dígitos.' }] },
      { status: 400 },
    );
  }

  const phoneNumberId = String(body.phone_number_id ?? '').trim();
  if (!/^\d{5,}$/.test(phoneNumberId)) {
    return NextResponse.json(
      {
        errors: [
          {
            field: 'phone_number_id',
            message: 'Cole o ID do número (Phone number ID), que é só dígitos — não o número de telefone.',
          },
        ],
      },
      { status: 400 },
    );
  }

  const ritmo = Number(body.msgs_por_segundo ?? 10);
  if (!Number.isInteger(ritmo) || ritmo < 1 || ritmo > 80) {
    return NextResponse.json(
      {
        errors: [
          { field: 'msgs_por_segundo', message: 'O ritmo precisa ficar entre 1 e 80 mensagens por segundo.' },
        ],
      },
      { status: 400 },
    );
  }

  // A conferência contra a Meta ANTES de gravar: um id errado vira erro aqui, e não
  // 20 mil linhas de fila falhando uma a uma daqui a três dias.
  let saude;
  try {
    saude = await lerSaudeDoNumero(phoneNumberId, token || null);
  } catch (e) {
    const erro = e instanceof CloudError ? e : new CloudError(String(e));
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('connections')
    .insert({
      nome,
      provider: 'cloud',
      instance_name: null,
      phone_number_id: phoneNumberId,
      waba_id: wabaId || null,
      status: 'conectada',
      modo_meta: 'cloud',
      numero: saude.numero,
      profile_name: saude.nome,
      qualidade: saude.qualidade,
      msgs_por_segundo: ritmo,
      limite_diario: Number.isInteger(Number(body.limite_diario)) ? Number(body.limite_diario) : 0,
    })
    .select()
    .single();
  if (error) {
    // 23505 é o índice único do phone_number_id: o número já está cadastrado.
    const duplicado = (error as { code?: string }).code === '23505';
    return NextResponse.json(
      { error: duplicado ? 'Este número da Meta já está cadastrado em outra conexão.' : error.message },
      { status: duplicado ? 409 : 500 },
    );
  }

  const conexao = data as Connection;

  if (token) {
    const { error: erroCofre } = await supabase.rpc('sf_meta_guardar_token', { p_conexao: conexao.id, p_token: token });
    if (erroCofre) {
      // Sem o token no cofre o número não manda nada: melhor não deixar a linha.
      await supabase.from('connections').delete().eq('id', conexao.id);
      return NextResponse.json({ error: `Não consegui guardar o token no cofre: ${erroCofre.message}` }, { status: 500 });
    }
    esquecerToken(phoneNumberId);
  }

  // O que o botão da Meta faz sozinho: assinar o app na conta (sem isso nenhuma
  // mensagem chega) e apontar o webhook DESTE número para cá. Falhar aqui não desfaz o
  // cadastro — o número já envia; o cartão tem o botão para tentar de novo.
  const avisos: string[] = [];
  if (wabaId) {
    try {
      await chamar(`/${wabaId}/subscribed_apps`, { method: 'POST', phone: phoneNumberId, token: token || null });
    } catch (e) {
      avisos.push(`Assinar o app na conta: ${e instanceof Error ? e.message : e}`);
    }
  } else {
    avisos.push('Sem o WABA ID não dá para assinar o app na conta — as respostas podem não chegar.');
  }
  const w = await apontarWebhookDoNumero(phoneNumberId, token || null);
  if ('erro' in w) avisos.push(`Webhook: ${w.erro}`);
  else conexao.webhook_apontado_em = new Date().toISOString();

  return NextResponse.json({ conexao, qrcode: null, limite: saude.limite, avisos }, { status: 201 });
}
