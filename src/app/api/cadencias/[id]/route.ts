import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { STATUS_EDITAVEIS, lerCategoria, lerDestino, nomeDoPasso } from '@/lib/cadencia';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** A cadência inteira, na ordem em que as mensagens saem, com os números de cada uma. */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: cadencia, error } = await supabase
    .from('cadencias')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cadencia) return NextResponse.json({ error: 'Cadência não encontrada.' }, { status: 404 });

  const { data: passos, error: erroPassos } = await supabase
    .from('campaigns')
    .select('*')
    .eq('cadencia_id', id)
    .order('enviar_em', { ascending: true, nullsFirst: false });
  if (erroPassos) return NextResponse.json({ error: erroPassos.message }, { status: 500 });

  const ids = (passos ?? []).map((p) => p.id);
  const { data: kpis } = ids.length
    ? await supabase
        .from('vw_campaign_kpis')
        .select('campaign_id,destinatarios,enviados,entregues,lidos,respostas,falhas,pendentes')
        .in('campaign_id', ids)
    : { data: [] };

  return NextResponse.json({
    cadencia,
    passos: (passos ?? []).map((p) => ({
      ...p,
      kpi: (kpis ?? []).find((k) => k.campaign_id === p.id) ?? null,
    })),
  });
}

/**
 * Renomeia ou troca o destino. O destino novo vale para os passos que ainda não saíram;
 * o que já foi enviado continua registrado para onde de fato foi.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const mudarDestino = 'alvo' in body || 'group_ids' in body || 'audience_id' in body || 'list_ids' in body;
  const patch: Record<string, unknown> = {};

  if ('nome' in body) {
    const nome = String(body.nome ?? '').trim();
    if (!nome) {
      return NextResponse.json({ errors: [{ field: 'nome', message: 'Dê um nome à cadência.' }] }, { status: 400 });
    }
    patch.nome = nome;
  }
  if ('categoria' in body) patch.categoria = lerCategoria(body.categoria);
  if (mudarDestino) {
    const { destino, errors } = lerDestino(body);
    if (errors.length) return NextResponse.json({ errors }, { status: 400 });
    Object.assign(patch, destino);
  } else if ('connection_id' in body) {
    patch.connection_id = typeof body.connection_id === 'string' && body.connection_id ? body.connection_id : null;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: cadencia, error } = await supabase
    .from('cadencias')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cadencia) return NextResponse.json({ error: 'Cadência não encontrada.' }, { status: 404 });

  // Propaga para os passos que ainda podem mudar. Nome entra porque o nome do passo
  // carrega o nome da cadência (é o que aparece na lista de Campanhas).
  const { data: abertos } = await supabase
    .from('campaigns')
    .select('id,enviar_em')
    .eq('cadencia_id', id)
    .in('status', [...STATUS_EDITAVEIS]);

  for (const passo of abertos ?? []) {
    const upd: Record<string, unknown> = {
      categoria: cadencia.categoria,
      alvo: cadencia.alvo,
      audience_id: cadencia.audience_id,
      group_ids: cadencia.group_ids,
      list_ids: cadencia.list_ids,
      connection_id: cadencia.connection_id,
    };
    if (passo.enviar_em) upd.nome = nomeDoPasso(cadencia.nome, passo.enviar_em);
    await supabase
      .from('campaigns')
      .update(upd)
      .eq('id', passo.id)
      .in('status', [...STATUS_EDITAVEIS]);
  }

  return NextResponse.json(cadencia);
}

/**
 * Apaga a cadência e os passos que ainda não saíram. O que já foi enviado fica no
 * histórico de Campanhas (a ligação vira nula pelo `on delete set null`).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: emEnvio } = await supabase
    .from('campaigns')
    .select('id')
    .eq('cadencia_id', id)
    .eq('status', 'enviando')
    .limit(1);
  if (emEnvio?.length) {
    return NextResponse.json(
      { error: 'Uma mensagem desta cadência está saindo agora. Espere terminar para apagar.' },
      { status: 409 },
    );
  }

  const { error: erroPassos } = await supabase
    .from('campaigns')
    .delete()
    .eq('cadencia_id', id)
    .in('status', [...STATUS_EDITAVEIS]);
  if (erroPassos) return NextResponse.json({ error: erroPassos.message }, { status: 500 });

  const { error } = await supabase.from('cadencias').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
