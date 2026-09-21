import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { comTagIds } from '@/lib/tags';

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('groups')
    .select('*, group_tag_links(tag_id)')
    .order('criado_em', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map(comTagIds));
}

export async function POST(req: Request) {
  const parsed = await readJson<{ group_id?: unknown; nome?: unknown; ativo?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const group_id = String(body.group_id ?? '').trim();
  const nome = String(body.nome ?? '').trim();
  if (!group_id || !nome) {
    return NextResponse.json({ error: 'group_id e nome são obrigatórios' }, { status: 400 });
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('groups')
    .insert({ group_id, nome, ativo: Boolean(body.ativo ?? true) })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, tag_ids: [] }, { status: 201 });
}
