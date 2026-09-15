import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { apagarInstancia, EvolutionError, infoInstancia } from '@/lib/whatsapp/evolution';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Lê a conexão e, de quebra, confere o estado real na Evolution.
 *
 * O banco pode estar desatualizado: se o celular ficou sem internet, o WhatsApp cai e
 * o webhook `connection.update` pode não chegar. Perguntar na hora é o que impede a
 * tela de mostrar "conectada" para um número que caiu ontem.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase.from('connections').select('*').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });

  const conexao = data as Connection;
  try {
    const info = await infoInstancia(conexao.instance_name);
    const mudou =
      info.estado !== conexao.status ||
      (info.numero && info.numero !== conexao.numero) ||
      (info.profileName && info.profileName !== conexao.profile_name);
    if (mudou) {
      const { data: atualizada } = await supabase
        .from('connections')
        .update({
          status: info.estado,
          numero: info.numero ?? conexao.numero,
          profile_name: info.profileName ?? conexao.profile_name,
          profile_pic_url: info.profilePicUrl ?? conexao.profile_pic_url,
          ultimo_erro: info.estado === 'conectada' ? null : conexao.ultimo_erro,
        })
        .eq('id', id)
        .select()
        .maybeSingle();
      return NextResponse.json({ conexao: atualizada ?? conexao });
    }
  } catch (e) {
    // A Evolution fora do ar não pode derrubar a tela: devolve o que está no banco
    // com o aviso, e a pessoa vê o motivo em vez de um erro genérico.
    return NextResponse.json({
      conexao,
      aviso: e instanceof EvolutionError ? e.message : String(e),
    });
  }
  return NextResponse.json({ conexao });
}

const CAMPOS_EDITAVEIS = ['nome', 'ativo', 'delay_min_seg', 'delay_max_seg', 'limite_diario'] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (!(campo in body)) continue;
    if (campo === 'nome') {
      const nome = String(body.nome ?? '').trim();
      if (!nome) {
        return NextResponse.json({ errors: [{ field: 'nome', message: 'O nome não pode ficar vazio.' }] }, { status: 400 });
      }
      patch.nome = nome;
    } else if (campo === 'ativo') {
      patch.ativo = Boolean(body.ativo);
    } else {
      const n = Number(body[campo]);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ errors: [{ field: campo, message: 'Valor inválido.' }] }, { status: 400 });
      }
      patch[campo] = n;
    }
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
  }

  // A restrição delay_max >= delay_min é do banco; validar aqui transforma um 500 cru
  // num erro que a tela sabe mostrar no campo certo.
  const supabase = createServerClient();
  const { data: atual } = await supabase
    .from('connections')
    .select('delay_min_seg,delay_max_seg')
    .eq('id', id)
    .maybeSingle();
  if (!atual) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  const min = Number(patch.delay_min_seg ?? atual.delay_min_seg);
  const max = Number(patch.delay_max_seg ?? atual.delay_max_seg);
  if (min < 1 || max < min) {
    return NextResponse.json(
      { errors: [{ field: 'delay_min_seg', message: 'O intervalo mínimo precisa ser ≥ 1s e ≤ o máximo.' }] },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('connections')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  return NextResponse.json({ conexao: data });
}

/**
 * Apaga a conexão aqui E a instância na Evolution.
 *
 * Bloqueado enquanto houver mensagem na fila para este número: apagar a conexão faria
 * `campaign_recipients.connection_id` virar nulo (on delete set null) e as linhas
 * ficariam pendentes para sempre, sem ninguém para enviá-las.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: conexao } = await supabase
    .from('connections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!conexao) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });

  const { count } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', id)
    .in('status', ['pendente', 'enviando']);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Esta conexão tem ${count} mensagem(ns) na fila. Cancele ou conclua as campanhas antes de removê-la.`,
      },
      { status: 409 },
    );
  }

  // Tenta apagar do lado da Evolution, mas não trava a remoção local: instância que já
  // não existe lá devolve 404, e insistir deixaria a conexão zumbi aqui para sempre.
  let aviso: string | null = null;
  try {
    await apagarInstancia((conexao as Connection).instance_name);
  } catch (e) {
    aviso = e instanceof EvolutionError ? e.message : String(e);
  }

  const { error } = await supabase.from('connections').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, aviso });
}
