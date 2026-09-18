import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { nomeDoPasso, validarPasso, type PassoEntrada } from '@/lib/cadencia';
import { dispararTick } from '@/lib/dispatch/gatilho';

export const dynamic = 'force-dynamic';

/** Acrescenta uma mensagem à cadência. Ela nasce agendada, com o destino da cadência. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<Partial<PassoEntrada>>(req);
  if (!parsed.ok) return parsed.res;
  const passo = parsed.data;

  const errors = validarPasso(passo, new Date());
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });

  const supabase = createServerClient();
  const { data: cadencia } = await supabase.from('cadencias').select('*').eq('id', id).maybeSingle();
  if (!cadencia) return NextResponse.json({ error: 'Cadência não encontrada.' }, { status: 404 });

  const enviarEm = new Date(passo.enviar_em as string).toISOString();
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      cadencia_id: id,
      nome: nomeDoPasso(cadencia.nome, enviarEm),
      categoria: cadencia.categoria,
      tipo: passo.tipo,
      mensagem: String(passo.mensagem ?? '').trim(),
      midia_url: passo.tipo === 'texto' ? null : (passo.midia_url ?? null),
      mencionar_todos: Boolean(passo.mencionar_todos),
      alvo: cadencia.alvo,
      audience_id: cadencia.audience_id,
      group_ids: cadencia.group_ids,
      list_ids: cadencia.list_ids,
      connection_id: cadencia.connection_id,
      enviar_em: enviarEm,
      status: 'agendada',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (new Date(enviarEm).getTime() <= Date.now() + 60_000) dispararTick('whatsapp');
  return NextResponse.json(data, { status: 201 });
}
