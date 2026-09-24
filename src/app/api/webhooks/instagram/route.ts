import { NextResponse, after } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@/lib/supabase/server';
import { lerConfigMeta } from '@/lib/whatsapp/meta-config';
import { lerConfigInstagram } from '@/lib/instagram/conexao';
import { processarWebhookInstagram } from '@/lib/instagram/motor';

export const dynamic = 'force-dynamic';
// Responder um comentário = até 3 idas à Meta (perfil, resposta pública, DM).
export const maxDuration = 60;

function confere(corpo: string, cabecalho: string | null, segredo: string): boolean {
  if (!cabecalho?.startsWith('sha256=')) return false;
  const a = Buffer.from(createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex'));
  const b = Buffer.from(cabecalho.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verificação da Meta ao cadastrar o webhook: devolve o desafio em TEXTO PURO. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const esperado = (await lerConfigMeta()).verifyToken ?? '';
  if (u.searchParams.get('hub.mode') === 'subscribe' && esperado && u.searchParams.get('hub.verify_token') === esperado) {
    return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  if (!u.searchParams.get('hub.mode')) return NextResponse.json({ ok: true, servico: 'sendflow/webhooks/instagram' });
  return NextResponse.json({ error: 'verificação recusada' }, { status: 403 });
}

export async function POST(req: Request) {
  const corpo = await req.text();
  // O evento vem assinado com a chave do app do Instagram OU do app da Meta, conforme o
  // produto que o gerou — aceita qualquer uma das que estiverem configuradas.
  // Nenhuma configurada = recusa (falha FECHADA, como os outros webhooks).
  const [ig, meta] = await Promise.all([lerConfigInstagram(), lerConfigMeta()]);
  const segredos = [ig.appSecret, meta.appSecret].filter((s): s is string => Boolean(s));
  if (!segredos.length) {
    return NextResponse.json({ error: 'Chave secreta do app não configurada — o webhook recusa eventos até lá.' }, { status: 503 });
  }
  const assinatura = req.headers.get('x-hub-signature-256');
  if (!segredos.some((s) => confere(corpo, assinatura, s))) {
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ ok: true, ignorado: 'corpo inválido' });
  }

  // Responde 200 na hora e processa depois: a Meta desiste (e reentrega) se esperar demais.
  after(async () => {
    const r = await processarWebhookInstagram(createServerClient(), payload);
    if (r.erros.length) console.error('[instagram] erros:', r.erros);
  });
  return NextResponse.json({ ok: true });
}
