import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { createServerClient } from '@/lib/supabase/server';
import { apontarWebhookDoApp, assinarConta } from '@/lib/instagram/conexao';
import { esquecerTokenIg } from '@/lib/instagram/api';

export const dynamic = 'force-dynamic';

/** Conserto no cartão da conta: reassinar os webhooks (conta + app). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ acao?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  if (parsed.data.acao !== 'webhook') return NextResponse.json({ error: 'ação desconhecida' }, { status: 400 });
  const db = createServerClient();
  const { data: conta } = await db.from('ig_contas').select('ig_user_id').eq('id', id).maybeSingle();
  if (!conta) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
  const erros: string[] = [];
  const a = await assinarConta(conta.ig_user_id);
  if ('erro' in a) erros.push(a.erro);
  const w = await apontarWebhookDoApp();
  if ('erro' in w) erros.push(w.erro);
  if (erros.length) return NextResponse.json({ error: erros.join(' | ') }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Desconecta: apaga o token do cofre. Conversas e automações ficam (reconectar recupera). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServerClient();
  const { data: conta } = await db.from('ig_contas').select('ig_user_id').eq('id', id).maybeSingle();
  if (!conta) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
  await db.rpc('sf_ig_apagar_token', { p_conta: id });
  await db.from('ig_contas').update({ status: 'desconectada' }).eq('id', id);
  esquecerTokenIg(conta.ig_user_id);
  return NextResponse.json({ ok: true });
}
