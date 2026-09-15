import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * A fila de uma campanha, destinatário a destinatário, com os KPIs dela no topo.
 *
 * É a tela que responde a pergunta mais concreta que existe depois de um disparo:
 * "quem NÃO recebeu?". Antes, a resposta era um contador de falhas sem nome.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = new URL(req.url).searchParams.get('status');
  const supabase = createServerClient();

  let q = supabase
    .from('campaign_recipients')
    .select('*')
    .eq('campaign_id', id)
    // Falha primeiro: quem abre esta tela quase sempre está atrás do que deu errado.
    .order('status', { ascending: true })
    .order('enviado_em', { ascending: true, nullsFirst: false })
    .limit(1000);
  if (status) q = q.eq('status', status);

  const [{ data: destinatarios, error }, { data: kpi }, { data: campanha }] = await Promise.all([
    q,
    supabase.from('vw_campaign_kpis').select('*').eq('campaign_id', id).maybeSingle(),
    supabase.from('campaigns').select('*').eq('id', id).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campanha) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

  return NextResponse.json({ campanha, kpi: kpi ?? null, destinatarios: destinatarios ?? [] });
}
