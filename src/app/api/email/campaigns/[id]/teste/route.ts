import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { montarEmail } from '@/lib/email/render';
import { enviarEmail, EmailError } from '@/lib/email/provider';
import { emailValido, normalizarEmail } from '@/lib/contatos';
import { urlPublica } from '@/lib/url';
import type { EmailCampaign } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Manda o e-mail de teste para um endereço, exatamente como as pessoas vão receber.
 *
 * O detalhe que importa: o token do teste começa com `teste-` e NÃO existe na fila.
 * Os endpoints de pixel, clique e descadastro procuram esse token, não encontram e
 * ignoram — então abrir o próprio teste dez vezes não move nenhum KPI. Sem essa
 * separação, toda campanha nasceria com uma abertura falsa (a sua).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ para?: unknown; nome?: unknown; variante?: unknown }>(req);
  if (!parsed.ok) return parsed.res;

  const para = normalizarEmail(String(parsed.data.para ?? ''));
  if (!emailValido(para)) {
    return NextResponse.json(
      { errors: [{ field: 'para', message: 'Informe um e-mail válido para o teste.' }] },
      { status: 400 },
    );
  }

  const supabase = createServerClient();
  const { data } = await supabase.from('email_campaigns').select('*').eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
  const campanha = data as EmailCampaign;

  if (!campanha.html.trim()) {
    return NextResponse.json({ error: 'A campanha ainda não tem conteúdo.' }, { status: 400 });
  }
  if (!campanha.remetente_email) {
    return NextResponse.json({ error: 'Defina o remetente antes de enviar o teste.' }, { status: 400 });
  }

  const usarB = parsed.data.variante === 'B' && Boolean(campanha.assunto_b);
  const nomeTeste = String(parsed.data.nome ?? '').trim() || 'Fulano de Tal';

  const { data: cfg } = await supabase
    .from('app_settings')
    .select('valor')
    .eq('chave', 'email_remetente')
    .maybeSingle();
  const rodape = (cfg?.valor ?? {}) as Record<string, string>;

  const montado = montarEmail(
    campanha.html,
    // O prefixo evita que um teste se perca no meio da caixa de entrada — e denuncia
    // na hora se alguém mandar um teste para a lista inteira por engano.
    `[TESTE] ${usarB && campanha.assunto_b ? campanha.assunto_b : campanha.assunto}`,
    {
      nome: nomeTeste,
      email: para,
      empresa: 'Empresa Exemplo',
      // Valores de exemplo para os campos livres aparecerem preenchidos no teste, em
      // vez de somem e darem a falsa impressão de que a variável não funciona.
      campos: { cidade: 'São Paulo', plano: 'Plano Exemplo' },
    },
    {
      baseUrl: urlPublica(),
      token: `teste-${Math.random().toString(36).slice(2, 10)}`,
      preheader: campanha.preheader,
      rodapeTexto: rodape.rodape_texto ?? null,
      rodapeEndereco: rodape.rodape_endereco ?? null,
    },
  );

  try {
    const envio = await enviarEmail({
      para,
      paraNome: nomeTeste,
      de: campanha.remetente_email,
      deNome: campanha.remetente_nome || campanha.remetente_email,
      responderPara: campanha.responder_para,
      assunto: montado.assunto,
      html: montado.html,
      texto: campanha.texto?.trim() ? campanha.texto : montado.texto,
      urlDescadastro: montado.urlDescadastro,
    });
    return NextResponse.json({ ok: true, provedor: envio.provedor, messageId: envio.messageId });
  } catch (e) {
    const erro = e instanceof EmailError ? e : new EmailError(String(e));
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }
}
