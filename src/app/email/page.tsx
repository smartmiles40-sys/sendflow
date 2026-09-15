import { createServerClient } from '@/lib/supabase/server';
import { provedorAtivo } from '@/lib/email/provider';
import type { EmailCampaign, EmailKpi } from '@/lib/types';
import { EmailListaClient } from './EmailListaClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'E-mail · SendFlow' };

export default async function EmailPage() {
  const supabase = createServerClient();
  const [{ data: campanhas }, { data: kpis }] = await Promise.all([
    supabase.from('email_campaigns').select('*').order('criado_em', { ascending: false }),
    supabase.from('vw_email_kpis').select('*'),
  ]);

  const porId = new Map(((kpis ?? []) as EmailKpi[]).map((k) => [k.campaign_id, k]));

  return (
    <EmailListaClient
      campanhas={((campanhas ?? []) as EmailCampaign[]).map((c) => ({
        ...c,
        kpi: porId.get(c.id) ?? null,
      }))}
      provedor={provedorAtivo()}
    />
  );
}
