import { createServerClient } from '@/lib/supabase/server';
import type { GroupTag } from '@/lib/types';
import { comTagIds } from '@/lib/tags';
import { GroupsClient } from './GroupsClient';

export const dynamic = 'force-dynamic';

export default async function GruposPage() {
  const supabase = createServerClient();
  const [{ data }, { data: tags }] = await Promise.all([
    supabase
      .from('groups')
      .select('*, group_tag_links(tag_id)')
      .order('criado_em', { ascending: false }),
    supabase.from('group_tags').select('*').order('nome'),
  ]);

  return (
    <GroupsClient
      initial={(data ?? []).map(comTagIds)}
      initialTags={(tags ?? []) as GroupTag[]}
    />
  );
}
