import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { createServerClient } from '@/lib/supabase/server';
import { validarAutomacao } from '@/lib/instagram/regras';

export const dynamic = 'force-dynamic';

/** Edita a automação inteira, ou só liga/desliga (`{ ativo }` sozinho). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const db = createServerClient();
  let patch: Record<string, unknown>;
  if (Object.keys(parsed.data).length === 1 && 'ativo' in parsed.data) {
    patch = { ativo: Boolean(parsed.data.ativo) };
  } else {
    const v = validarAutomacao(parsed.data);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
    patch = { ...v.valor };
  }
  const { data, error } = await db
    .from('ig_automacoes')
    .update({ ...patch, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Automação não encontrada.' }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await createServerClient().from('ig_automacoes').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
