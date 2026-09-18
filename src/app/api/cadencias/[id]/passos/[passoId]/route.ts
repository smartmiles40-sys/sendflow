import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { STATUS_EDITAVEIS, nomeDoPasso, validarPasso, type PassoEntrada } from '@/lib/cadencia';
import { dispararTick } from '@/lib/dispatch/gatilho';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; passoId: string }> };

/**
 * Edita uma mensagem da cadência, ou pausa/retoma.
 *
 * - `{ pausar: true }`  → volta para rascunho: fica no desenho, mas o motor não pega.
 * - `{ pausar: false }` → reagenda (a data precisa estar no futuro).
 * - campos do passo     → salva e deixa agendada.
 *
 * A guarda de status vai no próprio UPDATE: se o motor pegou a mensagem entre a
 * leitura e a gravação, nada muda e a resposta é 409 — nunca se troca o texto de algo
 * que já está saindo.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id, passoId } = await params;
  const parsed = await readJson<Partial<PassoEntrada> & { pausar?: boolean }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const supabase = createServerClient();

  const [{ data: atual }, { data: cadencia }] = await Promise.all([
    supabase.from('campaigns').select('*').eq('id', passoId).eq('cadencia_id', id).maybeSingle(),
    supabase.from('cadencias').select('nome').eq('id', id).maybeSingle(),
  ]);
  if (!atual || !cadencia) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });

  let upd: Record<string, unknown>;
  if (body.pausar === true) {
    upd = { status: 'rascunho' };
  } else {
    const final: Partial<PassoEntrada> = {
      tipo: body.tipo ?? atual.tipo,
      mensagem: body.mensagem ?? atual.mensagem,
      midia_url: 'midia_url' in body ? body.midia_url : atual.midia_url,
      mencionar_todos: body.mencionar_todos ?? atual.mencionar_todos,
      enviar_em: body.enviar_em ?? atual.enviar_em,
    };
    const errors = validarPasso(final, new Date());
    if (errors.length) return NextResponse.json({ errors }, { status: 400 });
    const enviarEm = new Date(final.enviar_em as string).toISOString();
    upd = {
      tipo: final.tipo,
      mensagem: String(final.mensagem).trim(),
      midia_url: final.tipo === 'texto' ? null : final.midia_url,
      mencionar_todos: Boolean(final.mencionar_todos),
      enviar_em: enviarEm,
      nome: nomeDoPasso(cadencia.nome, enviarEm),
      status: 'agendada',
    };
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update(upd)
    .eq('id', passoId)
    .eq('cadencia_id', id)
    .in('status', [...STATUS_EDITAVEIS])
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: 'Esta mensagem já está saindo ou já foi enviada — não dá mais para mudar.' },
      { status: 409 },
    );
  }

  if (data.status === 'agendada') {
    // Uma tentativa anterior (cancelada/erro) deixa fila velha; sem limpar, o fan-out
    // acharia que já existe e a mensagem nunca sairia de novo.
    await supabase.from('campaign_recipients').delete().eq('campaign_id', passoId);
    if (new Date(data.enviar_em).getTime() <= Date.now() + 60_000) dispararTick('whatsapp');
  }
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, passoId } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', passoId)
    .eq('cadencia_id', id)
    .in('status', [...STATUS_EDITAVEIS])
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: 'Mensagem já enviada ou saindo agora — ela fica no histórico.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
