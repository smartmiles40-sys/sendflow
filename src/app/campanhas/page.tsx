import { createServerClient } from '@/lib/supabase/server';
import type { Campaign } from '@/lib/types';
import { CampaignsClient } from './CampaignsClient';

export const dynamic = 'force-dynamic';

export default async function CampanhasPage() {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .eq('alvo', 'grupos')
    .order('enviar_em', { ascending: true });

  return <CampaignsClient initial={(data ?? []) as Campaign[]} />;
}
