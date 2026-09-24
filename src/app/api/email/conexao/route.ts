import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { urlPublica } from '@/lib/url';
import {
  conectarResend,
  criarWebhook,
  desconectarResend,
  escolherDominio,
  guardarSegredoWebhook,
  lerConfigEmail,
  lerDominio,
  listarDominios,
  ResendApiError,
  verificarDominio,
  type DominioResend,
} from '@/lib/email/config';

export const dynamic = 'force-dynamic';

const urlWebhook = () => `${urlPublica()}/api/webhooks/resend`;

/** O estado da conexão para a tela. Nenhum segredo sai daqui — só SE existe. */
export async function GET() {
  const cfg = await lerConfigEmail();
  let dominio: DominioResend | null = null;
  let dominios: DominioResend[] = [];
  let erro: string | null = null;
  if (cfg.resendKey) {
    try {
      [dominio, dominios] = await Promise.all([
        cfg.dominioId ? lerDominio(cfg.dominioId) : Promise.resolve(null),
        listarDominios(),
      ]);
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
  }
  return NextResponse.json({
    conectado: Boolean(cfg.resendKey),
    dominio,
    dominios: dominios.map((d) => ({ id: d.id, name: d.name, status: d.status })),
    webhookPronto: Boolean(cfg.resendWebhookSecret),
    urlWebhook: urlWebhook(),
    smtp: cfg.smtp,
    erro,
  });
}

export async function POST(req: Request) {
  const parsed = await readJson<{ acao?: unknown; chave?: unknown; dominio?: unknown; segredo?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  try {
    switch (b.acao) {
      case 'conectar':
        return NextResponse.json(await conectarResend(String(b.chave ?? '')));
      case 'dominio':
        return NextResponse.json({ dominio: await escolherDominio(String(b.dominio ?? '')) });
      case 'verificar':
        return NextResponse.json({ dominio: await verificarDominio() });
      case 'webhook':
        return NextResponse.json(await criarWebhook(urlWebhook()));
      case 'segredo_webhook':
        await guardarSegredoWebhook(String(b.segredo ?? ''));
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
    }
  } catch (e) {
    // 4xx do Resend vira 400 aqui: um 401 devolvido cru pareceria 'sessão expirada' para a tela.
    const status = e instanceof ResendApiError && e.status >= 400 && e.status < 500 ? 400 : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}

export async function DELETE() {
  await desconectarResend();
  return NextResponse.json({ ok: true });
}
