import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { comTagIds } from '@/lib/tags';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ ativo?: unknown; nome?: unknown; tag_ids?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const clean: Record<string, unknown> = {};
  if ('ativo' in body) clean.ativo = Boolean(body.ativo);
  if ('nome' in body) {
    const n = String(body.nome ?? '').trim();
    if (!n) return NextResponse.json({ error: 'nome não pode ser vazio' }, { status: 400 });
    clean.nome = n;
  }
  let tagIds: string[] | null = null;
  if ('tag_ids' in body) {
    if (!Array.isArray(body.tag_ids)) {
      return NextResponse.json({ error: 'tag_ids deve ser uma lista' }, { status: 400 });
    }
    tagIds = [...new Set(body.tag_ids.map(String).filter(Boolean))];
  }
  if (Object.keys(clean).length === 0 && tagIds === null) {
    return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 });
  }

  const supabase = createServerClient();
  if (Object.keys(clean).length) {
    const { error } = await supabase.from('groups').update(clean).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (tagIds !== null) {
    // Troca o conjunto inteiro: tira as que saíram, põe as que entraram.
    const { error: e1 } = tagIds.length
      ? await supabase.from('group_tag_links').delete().eq('group_id', id).not('tag_id', 'in', `(${tagIds.join(',')})`)
      : await supabase.from('group_tag_links').delete().eq('group_id', id);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    if (tagIds.length) {
      const { error: e2 } = await supabase
        .from('group_tag_links')
        .upsert(tagIds.map((tag_id) => ({ group_id: id, tag_id })), { onConflict: 'group_id,tag_id', ignoreDuplicates: true });
      if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
    }
  }
  const { data, error } = await supabase
    .from('groups').select('*, group_tag_links(tag_id)').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(comTagIds(data));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { error } = await supabase.from('groups').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
