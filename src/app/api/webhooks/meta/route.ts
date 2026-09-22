import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@/lib/supabase/server';
import { ehPedidoDeParada } from '@/lib/whatsapp/massa';
import { normalizarTelefoneBR } from '@/lib/whatsapp/jid';

export const dynamic = 'force-dynamic';

/**
 * A porta de entrada do disparo em massa.
 *
 * Tudo que acontece DEPOIS de a mensagem sair chega por aqui: o ✓✓ cinza, o ✓✓ azul, a
 * falha de entrega com o código real da Meta, a resposta da pessoa e — o mais
 * importante deste arquivo — o pedido de saída.
 *
 * Duas regras valem para tudo o que acontece aqui, herdadas do webhook da Evolution e
 * aprendidas na prática:
 *
 *   1. RESPONDER RÁPIDO E SEMPRE 200. A Meta reenvia o que falha e, depois de muitas
 *      falhas seguidas, DESATIVA a assinatura do webhook — e aí a ingestão inteira
 *      para em silêncio, com o painel mostrando 0% de leitura, que é indistinguível de
 *      "ninguém leu". Erro nosso não vira erro para a Meta.
 *   2. NADA PESADO NO CAMINHO. Consulta por índice e update. Sem varredura, sem
 *      agregação, sem recalcular campanha.
 *
 * A única exceção à regra 1 é a assinatura: um corpo que não confere é 401, porque
 * aceitar evento forjado significa deixar qualquer um descadastrar a base inteira.
 */

/** Ordem do funil. Um status só avança o estado — nunca puxa de volta. */
const ORDEM: Record<string, number> = {
  pendente: 0,
  enviando: 1,
  enviado: 2,
  entregue: 3,
  lido: 4,
};

const CARIMBO: Record<string, string> = {
  enviado: 'enviado_em',
  entregue: 'entregue_em',
  lido: 'lido_em',
};

/** `sent | delivered | read | failed` da Meta → o nosso vocabulário. */
function traduzirStatus(bruto: string): 'enviado' | 'entregue' | 'lido' | 'falha' | null {
  switch (String(bruto ?? '').toLowerCase()) {
    case 'sent':
      return 'enviado';
    case 'delivered':
      return 'entregue';
    case 'read':
      return 'lido';
    case 'failed':
      return 'falha';
    default:
      // `deleted` e o que a Meta inventar depois: ignorado em vez de quebrar.
      return null;
  }
}

/**
 * Confere a assinatura `X-Hub-Signature-256` da Meta: HMAC-SHA256 do corpo CRU com o
 * segredo do app.
 *
 * O corpo precisa ser o texto exato recebido — reserializar o JSON muda espaços e
 * ordem de chaves, e a assinatura deixa de bater. Daí a rota ler `req.text()` e só
 * depois fazer o parse.
 */
function assinaturaConfere(corpoCru: string, cabecalho: string | null, appSecret: string): boolean {
  if (!cabecalho?.startsWith('sha256=')) return false;
  const esperada = createHmac('sha256', appSecret).update(corpoCru, 'utf8').digest('hex');
  const recebida = cabecalho.slice('sha256='.length);
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(recebida, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Formato do evento da Meta ────────────────────────────────────────────────────

interface StatusMeta {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

interface MensagemMeta {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

/** O texto que a pessoa mandou, venha ele de texto livre ou de botão. */
function textoDaMensagem(m: MensagemMeta): string {
  if (m.text?.body) return m.text.body;
  // Botão do template conta como resposta — e é justamente por ali que a Meta manda o
  // "Parar promoções" do botão de opt-out nativo.
  if (m.button?.text) return m.button.text;
  if (m.interactive?.button_reply?.title) return m.interactive.button_reply.title;
  if (m.interactive?.list_reply?.title) return m.interactive.list_reply.title;
  return '';
}

/**
 * A Meta faz um GET de verificação ao cadastrar o webhook: precisa receber de volta o
 * `hub.challenge`, como TEXTO PURO. Devolver JSON aqui reprova a verificação.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const desafio = url.searchParams.get('hub.challenge') ?? '';
  const esperado = (process.env.META_WEBHOOK_VERIFY_TOKEN ?? '').trim();

  if (modo === 'subscribe' && esperado && token === esperado) {
    return new Response(desafio, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  // Sem os parâmetros de verificação, serve de "estou de pé" para quem abrir no navegador.
  if (!modo) return NextResponse.json({ ok: true, servico: 'sendflow/webhooks/meta' });
  return NextResponse.json({ error: 'verificação recusada' }, { status: 403 });
}

export async function POST(req: Request) {
  const appSecret = (process.env.META_APP_SECRET ?? '').trim();
  const corpoCru = await req.text();

  // Falha FECHADA: sem segredo configurado o endpoint não aceita nada. É a mesma
  // decisão tomada no webhook do Resend em 17/09 — um webhook aberto de WhatsApp
  // permite forjar entregas, inventar leituras e descadastrar contatos.
  if (!appSecret) {
    return NextResponse.json(
      { error: 'META_APP_SECRET não configurado — o webhook recusa eventos até lá.' },
      { status: 503 },
    );
  }
  if (!assinaturaConfere(corpoCru, req.headers.get('x-hub-signature-256'), appSecret)) {
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(corpoCru) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true, ignorado: 'corpo inválido' });
  }

  try {
    const supabase = createServerClient();
    let tratados = 0;

    const entradas = (payload.entry ?? []) as { changes?: { value?: Record<string, unknown> }[] }[];
    for (const entrada of entradas) {
      for (const mudanca of entrada.changes ?? []) {
        const valor = mudanca.value ?? {};

        for (const status of (valor.statuses ?? []) as StatusMeta[]) {
          if (await aplicarStatus(supabase, status)) tratados += 1;
        }
        for (const mensagem of (valor.messages ?? []) as MensagemMeta[]) {
          if (await aplicarMensagem(supabase, mensagem)) tratados += 1;
        }
      }
    }

    return NextResponse.json({ ok: true, tratados });
  } catch (e) {
    // Ver a regra 1 no topo.
    console.error('[webhook meta] falhou:', e);
    return NextResponse.json({ ok: true, erro: 'processamento falhou' });
  }
}

/** ✓ ✓✓ ✓✓azul e a falha com o código real. */
async function aplicarStatus(
  supabase: ReturnType<typeof createServerClient>,
  status: StatusMeta,
): Promise<boolean> {
  const novoStatus = traduzirStatus(status.status ?? '');
  if (!novoStatus || !status.id) return false;

  const { data: linha } = await supabase
    .from('campaign_recipients')
    .select('id,status')
    .eq('provider_message_id', status.id)
    .maybeSingle();
  // Mensagem que não saiu daqui (conversa normal do número): nada a fazer.
  if (!linha) return false;

  if (novoStatus === 'falha') {
    const erro = status.errors?.[0];
    const detalhe = erro?.error_data?.details ?? erro?.message ?? erro?.title ?? 'sem detalhe';
    await supabase
      .from('campaign_recipients')
      .update({
        status: 'falha',
        erro: `A Meta não entregou: ${String(detalhe).slice(0, 400)}`,
        codigo_erro: erro?.code === undefined ? null : String(erro.code),
      })
      .eq('id', linha.id);
    return true;
  }

  // Status chegam fora de ordem com frequência (READ antes de DELIVERED, ou repetido).
  // Sem esta guarda, "lido" viraria "entregue" e a taxa de leitura oscilaria sozinha.
  const atual = ORDEM[linha.status as string] ?? 0;
  if (ORDEM[novoStatus] <= atual) return false;

  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = { status: novoStatus };
  patch[CARIMBO[novoStatus]] = agora;
  // Um "lido" que chega sem o "entregue" anterior deixaria um buraco no funil.
  if (novoStatus === 'lido') patch.entregue_em = agora;

  await supabase.from('campaign_recipients').update(patch).eq('id', linha.id);
  return true;
}

/**
 * A pessoa respondeu. Duas coisas acontecem, nesta ordem de importância:
 *
 *   1. se for pedido de saída, o contato é descadastrado NA HORA. Insistir com quem
 *      pediu para parar é o que derruba a qualidade do número na Meta — e a qualidade
 *      é quem define o teto diário de todo o resto;
 *   2. a resposta é creditada à última mensagem enviada àquele número nos últimos 7
 *      dias, que é a atribuição honesta possível sem ler o conteúdo.
 */
async function aplicarMensagem(
  supabase: ReturnType<typeof createServerClient>,
  mensagem: MensagemMeta,
): Promise<boolean> {
  const de = normalizarTelefoneBR(String(mensagem.from ?? ''));
  if (!de) return false;

  const texto = textoDaMensagem(mensagem);

  if (texto && ehPedidoDeParada(texto)) {
    const agora = new Date().toISOString();
    await supabase
      .from('contacts')
      .update({ status_whatsapp: 'descadastrado', optout_whatsapp_em: agora })
      .eq('telefone', de)
      .neq('status_whatsapp', 'descadastrado');

    // Tira da fila o que ainda não saiu para esta pessoa. Sem isto, o opt-out só
    // valeria para a PRÓXIMA campanha, e as 9 mil mensagens já enfileiradas desta
    // continuariam indo — que é exatamente o comportamento que gera denúncia.
    await supabase
      .from('campaign_recipients')
      .update({ status: 'cancelado', erro: 'Contato pediu para parar de receber.' })
      .eq('destino', de)
      .eq('status', 'pendente');
    return true;
  }

  const corte = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: linha } = await supabase
    .from('campaign_recipients')
    .select('id')
    .eq('destino', de)
    .is('respondido_em', null)
    .gte('enviado_em', corte)
    .order('enviado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!linha) return false;

  await supabase
    .from('campaign_recipients')
    .update({ respondido_em: new Date().toISOString() })
    .eq('id', linha.id);
  return true;
}
