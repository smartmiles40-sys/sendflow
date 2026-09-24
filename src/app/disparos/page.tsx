import { createServerClient } from '@/lib/supabase/server';
import type { Campaign } from '@/lib/types';
import { CampaignsClient } from '../campanhas/CampaignsClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Disparo em massa · SendFlow' };

/** Módulo ManyChat: as campanhas para CONTATOS, que só saem pela API oficial (0019). */
export default async function DisparosPage() {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .eq('alvo', 'contatos')
    .order('enviar_em', { ascending: true });

  return <CampaignsClient initial={(data ?? []) as Campaign[]} modo="contatos" />;
}
