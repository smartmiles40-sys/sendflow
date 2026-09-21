import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { corValida, validarNomeTag } from '@/lib/tags';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ nome?: unknown; cor?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const clean: Record<string, unknown> = {};
  if ('nome' in parsed.data) {
    const v = validarNomeTag(parsed.data.nome);
    if ('erro' in v) return NextResponse.json({ error: v.erro }, { status: 400 });
    clean.nome = v.nome;
  }
  if ('cor' in parsed.data) {
    if (!corValida(parsed.data.cor)) return NextResponse.json({ error: 'Cor inválida.' }, { status: 400 });
    clean.cor = parsed.data.cor;
  }
  if (!Object.keys(clean).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase.from('group_tags').update(clean).eq('id', id).select().single();
  if (error) {
    const duplicada = error.code === '23505';
    return NextResponse.json(
      { error: duplicada ? 'Já existe outra tag com esse nome.' : error.message },
      { status: duplicada ? 409 : 500 },
    );
  }
  return NextResponse.json(data);
}

/** Apaga a tag. Os grupos continuam; só perdem a etiqueta (on delete cascade na ligação). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { error } = await supabase.from('group_tags').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
