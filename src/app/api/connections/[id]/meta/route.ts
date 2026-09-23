import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { apontarWebhookDoNumero, lerStatusNaMeta, registrarNumero } from '@/lib/whatsapp/meta-conexao';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function carregar(id: string): Promise<Connection | null> {
  const { data } = await createServerClient().from('connections').select('*').eq('id', id).maybeSingle();
  const c = data as Connection | null;
  return c && c.provider === 'cloud' && c.phone_number_id ? c : null;
}

/** O que a Meta diz AGORA sobre o número: CONNECTED/PENDING, nome aprovado, limite. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await carregar(id);
  if (!c) return NextResponse.json({ error: 'Número oficial não encontrado.' }, { status: 404 });
  return NextResponse.json({ meta: await lerStatusNaMeta(c.phone_number_id!) });
}

/**
 * Consertos do cartão do número:
 *   { acao: 'registrar', pin }  → registra na Cloud API um número "Pendente"
 *   { acao: 'webhook' }         → reaponta o webhook deste número para o SendFlow
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await carregar(id);
  if (!c) return NextResponse.json({ error: 'Número oficial não encontrado.' }, { status: 404 });
  const parsed = await readJson<{ acao?: unknown; pin?: unknown }>(req);
  if (!parsed.ok) return parsed.res;

  if (parsed.data.acao === 'registrar') {
    const r = await registrarNumero(c.phone_number_id!, String(parsed.data.pin ?? ''));
    if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (parsed.data.acao === 'webhook') {
    const r = await apontarWebhookDoNumero(c.phone_number_id!);
    if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ ok: true, url: r.url });
  }
  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
