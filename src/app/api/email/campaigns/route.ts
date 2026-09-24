import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { parseEmailCampanha } from '@/lib/email/validacao';
import { dispararTick } from '@/lib/dispatch/gatilho';
import { provedorAtivo } from '@/lib/email/provider';

export const dynamic = 'force-dynamic';

/** A lista de campanhas já vem com os KPIs — a tela não faz uma consulta por linha. */
export async function GET() {
  const supabase = createServerClient();
  const [{ data: campanhas, error }, { data: kpis }] = await Promise.all([
    supabase.from('email_campaigns').select('*').order('criado_em', { ascending: false }),
    supabase.from('vw_email_kpis').select('*'),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const porId = new Map((kpis ?? []).map((k) => [k.campaign_id, k]));
  return NextResponse.json({
    campanhas: (campanhas ?? []).map((c) => ({ ...c, kpi: porId.get(c.id) ?? null })),
    provedor: (await provedorAtivo()),
  });
}

export async function POST(req: Request) {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // `agendar: false` (o padrão) salva rascunho; `true` coloca na fila.
  const agendar = body.agendar === true;
  const { valor, errors } = parseEmailCampanha(body, { rascunho: !agendar });
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });

  if (agendar && !(await provedorAtivo())) {
    return NextResponse.json(
      { error: 'Nenhum provedor de e-mail configurado. Configure Resend ou SMTP antes de agendar.' },
      { status: 503 },
    );
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('email_campaigns')
    .insert({
      ...valor,
      status: agendar ? 'agendada' : 'rascunho',
      enviar_em: agendar ? (valor.enviar_em ?? new Date().toISOString()) : valor.enviar_em,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (data.status === 'agendada' && new Date(data.enviar_em).getTime() <= Date.now() + 60_000) {
    dispararTick('email');
  }

  return NextResponse.json(data, { status: 201 });
}
