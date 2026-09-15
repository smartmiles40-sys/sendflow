import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { isCategoria } from '@/lib/categories';
import { dispararTick } from '@/lib/dispatch/gatilho';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase.from('campaigns').select('*').eq('id', id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

const CAMPOS_EDITAVEIS = [
  'nome',
  'mensagem',
  'midia_url',
  'mencionar_todos',
  'enviar_em',
  'audience_id',
  'group_ids',
  'tipo',
  'categoria',
  'alvo',
  'list_ids',
  'connection_id',
];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const patch = parsed.data;
  const supabase = createServerClient();

  /**
   * Abortar um disparo EM ANDAMENTO é um caminho próprio, e não uma edição.
   *
   * O motor manda em ritmo de 8–15 s por grupo, então uma campanha grande fica minutos
   * em 'enviando'. Se o texto saiu com erro, esses minutos são a única janela para
   * conter o estrago — e a regra antiga ("nada se mexe durante o envio") transformava
   * isso em assistir de camarote. O que já saiu não volta; o que está na fila é
   * cancelado, e o motor para de pegar linhas assim que a campanha deixa de estar
   * 'enviando'.
   */
  if (patch.status === 'cancelada') {
    const { data: cancelada, error } = await supabase
      .from('campaigns')
      .update({ status: 'cancelada' })
      .eq('id', id)
      .in('status', ['agendada', 'enviando', 'rascunho'])
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!cancelada) {
      return NextResponse.json(
        { error: 'Campanha já enviada ou cancelada — não há o que interromper.' },
        { status: 409 },
      );
    }
    const { data: paradas } = await supabase
      .from('campaign_recipients')
      .update({ status: 'cancelado' })
      .eq('campaign_id', id)
      .eq('status', 'pendente')
      .select('id');
    return NextResponse.json({ ...cancelada, cancelados: paradas?.length ?? 0 });
  }

  // Validação dos campos com restrição no banco, para um valor ruim virar 400 e não 500.
  if ('tipo' in patch && !['texto', 'imagem', 'video', 'pdf'].includes(patch.tipo as string)) {
    return NextResponse.json({ errors: [{ field: 'tipo', message: 'Tipo inválido.' }] }, { status: 400 });
  }
  if ('categoria' in patch && !isCategoria(patch.categoria)) {
    return NextResponse.json({ errors: [{ field: 'categoria', message: 'Categoria inválida.' }] }, { status: 400 });
  }
  if ('alvo' in patch && !['grupos', 'contatos'].includes(patch.alvo as string)) {
    return NextResponse.json({ errors: [{ field: 'alvo', message: 'Alvo inválido.' }] }, { status: 400 });
  }
  for (const campo of ['group_ids', 'list_ids'] as const) {
    if (
      campo in patch &&
      patch[campo] !== null &&
      !(Array.isArray(patch[campo]) && (patch[campo] as unknown[]).every((x) => typeof x === 'string'))
    ) {
      return NextResponse.json({ errors: [{ field: campo, message: `${campo} inválido.` }] }, { status: 400 });
    }
  }

  const clean: Record<string, unknown> = {};
  for (const k of CAMPOS_EDITAVEIS) if (k in patch) clean[k] = patch[k];
  // Reenviar devolve a campanha para a fila. Os outros status (enviando/enviada/erro)
  // são do motor — o cliente não escreve neles.
  if (patch.status === 'agendada') clean.status = 'agendada';

  if (!Object.keys(clean).length) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
  }

  // Guarda atômica: nunca alterar uma campanha em envio ou já enviada. É o que impede
  // trocar o texto no meio do disparo ou ressuscitar algo que já foi para os grupos.
  const { data, error } = await supabase
    .from('campaigns')
    .update(clean)
    .eq('id', id)
    .not('status', 'in', '("enviando","enviada")')
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: 'Campanha em envio ou já enviada — não pode ser alterada.' },
      { status: 409 },
    );
  }

  if (data.status === 'agendada') {
    // Reenvio limpa o rastro da tentativa anterior: sem isso, o fan-out acha que a
    // fila já existe (índice único campaign_id+destino) e a campanha nunca sai de novo.
    await supabase.from('campaign_recipients').delete().eq('campaign_id', id);
    if (new Date(data.enviar_em).getTime() <= Date.now() + 60_000) dispararTick('whatsapp');
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  // Campanha em envio não se apaga: o motor ainda está escrevendo o resultado dela.
  // (A fila sai junto, por `on delete cascade` em campaign_recipients.)
  const { data, error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', id)
    .neq('status', 'enviando')
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: 'Não foi possível excluir (campanha em envio ou inexistente).' },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
