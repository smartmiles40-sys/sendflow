import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Põe ou tira UMA tag de VÁRIOS grupos de uma vez — o "marcar os 12 grupos da live do
 * Peru" sem abrir grupo por grupo.
 */
export async function POST(req: Request) {
  const parsed = await readJson<{ group_ids?: unknown; tag_id?: unknown; acao?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const { acao } = parsed.data;
  const tagId = String(parsed.data.tag_id ?? '').trim();
  const ids = Array.isArray(parsed.data.group_ids)
    ? [...new Set(parsed.data.group_ids.map(String).filter(Boolean))]
    : [];
  if (!tagId || !ids.length) {
    return NextResponse.json({ error: 'Escolha a tag e pelo menos um grupo.' }, { status: 400 });
  }
  if (acao !== 'adicionar' && acao !== 'remover') {
    return NextResponse.json({ error: 'acao deve ser adicionar ou remover' }, { status: 400 });
  }
  const supabase = createServerClient();
  const { error } =
    acao === 'adicionar'
      ? await supabase
          .from('group_tag_links')
          .upsert(ids.map((group_id) => ({ group_id, tag_id: tagId })), { onConflict: 'group_id,tag_id', ignoreDuplicates: true })
      : await supabase.from('group_tag_links').delete().eq('tag_id', tagId).in('group_id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, grupos: ids.length });
}
