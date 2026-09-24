import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { validarRegras } from '@/lib/segmentos';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ nome?: unknown; descricao?: unknown; regras?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if ('nome' in b) {
    const nome = String(b.nome ?? '').trim();
    if (!nome) return NextResponse.json({ error: 'Dê um nome ao segmento.' }, { status: 400 });
    patch.nome = nome;
  }
  if ('descricao' in b) patch.descricao = String(b.descricao ?? '').trim() || null;

  const supabase = createServerClient();
  if ('regras' in b) {
    const v = validarRegras(b.regras);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
    if (!v.regras.condicoes.length) return NextResponse.json({ error: 'Adicione pelo menos uma condição.' }, { status: 400 });
    const { error: e1 } = await supabase.rpc('sf_filtrar_contatos', { p_regras: v.regras, p_limite: 1, p_offset: 0 });
    if (e1) return NextResponse.json({ error: `O banco recusou as regras: ${e1.message}` }, { status: 400 });
    patch.regras = v.regras;
  }

  const { data, error } = await supabase.from('segments').update(patch).eq('id', id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Segmento não encontrado.' }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  // Campanha agendada que usa o segmento perderia o público em silêncio (on delete set null).
  const { count } = await supabase
    .from('email_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('segment_id', id)
    .in('status', ['agendada', 'enviando']);
  if (count) {
    return NextResponse.json(
      { error: `Este segmento é o público de ${count} campanha(s) agendada(s). Troque o público delas antes de apagar.` },
      { status: 409 },
    );
  }
  const { error } = await supabase.from('segments').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
