import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { validateCampaign, type CampaignDraft } from '@/lib/validation';
import { buildCampaignRow } from '@/lib/campaign-row';
import { readJson } from '@/lib/http';
import { dispararTick } from '@/lib/dispatch/gatilho';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status');
  const supabase = createServerClient();
  let query = supabase.from('campaigns').select('*').order('enviar_em', { ascending: true });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const parsed = await readJson<{
    draft?: unknown;
    asDraft?: unknown;
    audience_id?: unknown;
    group_ids?: unknown;
    alvo?: unknown;
    list_ids?: unknown;
    connection_id?: unknown;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const draft = body.draft as CampaignDraft | undefined;
  if (!draft || typeof draft !== 'object') {
    return NextResponse.json({ error: 'draft é obrigatório' }, { status: 400 });
  }
  if (!['texto', 'imagem', 'video', 'pdf'].includes(draft.tipo)) {
    return NextResponse.json({ errors: [{ field: 'tipo', message: 'Tipo inválido.' }] }, { status: 400 });
  }

  const asDraft = Boolean(body.asDraft);
  const alvo = body.alvo === 'contatos' ? ('contatos' as const) : ('grupos' as const);
  const listIds = Array.isArray(body.list_ids) ? (body.list_ids as string[]) : null;

  if (!asDraft && alvo === 'contatos' && !listIds?.length) {
    return NextResponse.json(
      { errors: [{ field: 'list_ids', message: 'Escolha ao menos uma lista de contatos.' }] },
      { status: 400 },
    );
  }

  if (!asDraft) {
    const errors = validateCampaign(draft, new Date());
    if (errors.length) return NextResponse.json({ errors }, { status: 400 });
  }

  const row = buildCampaignRow(
    draft,
    {
      audienceId: (body.audience_id as string | null) ?? null,
      groupIds: Array.isArray(body.group_ids) ? (body.group_ids as string[]) : null,
      alvo,
      listIds,
      connectionId: (body.connection_id as string | null) ?? null,
    },
    new Date(),
    { asDraft },
  );

  const supabase = createServerClient();
  const { data, error } = await supabase.from('campaigns').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // "Enviar agora" acorda o motor na hora, em vez de esperar o próximo ciclo do cron.
  // A janela de 60 s pega também o agendamento "daqui a pouco" que cairia entre ciclos.
  // Se este atalho falhar, o cron pega a campanha do mesmo jeito — daí não haver
  // tratamento de erro aqui.
  if (data?.status === 'agendada' && new Date(data.enviar_em).getTime() <= Date.now() + 60_000) {
    dispararTick('whatsapp');
  }

  return NextResponse.json(data, { status: 201 });
}
