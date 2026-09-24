import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { parseEmailCampanha } from '@/lib/email/validacao';
import { dispararTick } from '@/lib/dispatch/gatilho';
import { provedorAtivo } from '@/lib/email/provider';
import type { EmailCampaign } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** A campanha com tudo que a tela de resultado precisa: KPIs, teste A/B e links. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: campanha, error } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campanha) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

  const [{ data: kpi }, { data: links }, { data: ab }] = await Promise.all([
    supabase.from('vw_email_kpis').select('*').eq('campaign_id', id).maybeSingle(),
    supabase
      .from('vw_email_links')
      .select('*')
      .eq('campaign_id', id)
      .order('cliques', { ascending: false })
      .limit(20),
    campanha.assunto_b
      ? supabase.from('vw_email_ab').select('*').eq('campaign_id', id)
      : Promise.resolve({ data: [] }),
  ]);

  return NextResponse.json({ campanha, kpi: kpi ?? null, links: links ?? [], ab: ab ?? [] });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const supabase = createServerClient();

  const { data: atual } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!atual) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
  const campanha = atual as EmailCampaign;

  /**
   * Interromper um envio em andamento. Mesma lógica do WhatsApp e, no e-mail, ainda
   * mais valiosa: com link errado ou preço errado, cada segundo a mais é gente a mais
   * recebendo algo que não volta.
   */
  if (body.status === 'cancelada') {
    if (!['agendada', 'enviando', 'rascunho'].includes(campanha.status)) {
      return NextResponse.json({ error: 'Campanha já enviada ou cancelada.' }, { status: 409 });
    }
    await supabase.from('email_campaigns').update({ status: 'cancelada' }).eq('id', id);
    const { data: paradas } = await supabase
      .from('email_recipients')
      .update({ status: 'cancelado' })
      .eq('campaign_id', id)
      .eq('status', 'pendente')
      .select('id');
    return NextResponse.json({ ok: true, cancelados: paradas?.length ?? 0 });
  }

  // Campanha que já saiu (ou está saindo) é histórico: não se reescreve, porque o HTML
  // guardado aqui é a única prova do que foi realmente enviado às pessoas.
  if (campanha.status === 'enviando' || campanha.status === 'enviada') {
    return NextResponse.json(
      { error: 'Campanha em envio ou já enviada — não pode ser alterada.' },
      { status: 409 },
    );
  }

  const agendar = body.agendar === true;
  const { valor, errors } = parseEmailCampanha(
    { ...(campanha as unknown as Record<string, unknown>), ...body },
    { rascunho: !agendar },
  );
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });

  if (agendar && !(await provedorAtivo())) {
    return NextResponse.json(
      { error: 'Nenhum provedor de e-mail configurado. Configure Resend ou SMTP antes de agendar.' },
      { status: 503 },
    );
  }

  const patch: Record<string, unknown> = { ...valor };
  if (agendar) {
    patch.status = 'agendada';
    patch.enviar_em = valor.enviar_em ?? new Date().toISOString();
  } else if (body.status === 'rascunho') {
    patch.status = 'rascunho';
  }

  const { data, error } = await supabase
    .from('email_campaigns')
    .update(patch)
    .eq('id', id)
    .not('status', 'in', '("enviando","enviada")')
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Campanha em envio ou já enviada.' }, { status: 409 });

  if (data.status === 'agendada') {
    // Reagendar limpa a fila anterior: o índice único (campaign_id, email) faria o
    // fan-out achar que já montou a fila e a campanha nunca sairia de novo.
    await supabase.from('email_recipients').delete().eq('campaign_id', id);
    if (new Date(data.enviar_em).getTime() <= Date.now() + 60_000) dispararTick('email');
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('email_campaigns')
    .delete()
    .eq('id', id)
    .neq('status', 'enviando')
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: 'Não foi possível excluir (campanha em envio).' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
