import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ nome?: unknown; descricao?: unknown; cor?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if ('nome' in body) {
    const nome = String(body.nome ?? '').trim();
    if (!nome) return NextResponse.json({ errors: [{ field: 'nome', message: 'O nome não pode ficar vazio.' }] }, { status: 400 });
    patch.nome = nome;
  }
  if ('descricao' in body) patch.descricao = String(body.descricao ?? '').trim() || null;
  if ('cor' in body && /^#[0-9a-fA-F]{6}$/.test(String(body.cor))) patch.cor = body.cor;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase.from('lists').update(patch).eq('id', id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Lista não encontrada.' }, { status: 404 });
  return NextResponse.json(data);
}

/**
 * Apaga a lista. Os contatos NÃO são apagados — só o vínculo (cascade em list_members).
 * Bloqueado enquanto uma campanha de e-mail agendada ainda depender dela: sem isso,
 * a campanha dispararia para lista vazia e "não saiu nada" ficaria sem explicação.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: emUso } = await supabase
    .from('email_campaigns')
    .select('nome')
    .in('status', ['agendada', 'enviando'])
    .contains('list_ids', [id])
    .limit(3);
  if (emUso?.length) {
    return NextResponse.json(
      {
        error: `Esta lista é o público de: ${emUso.map((c) => c.nome).join(', ')}. Cancele ou conclua essas campanhas antes.`,
      },
      { status: 409 },
    );
  }

  const { error } = await supabase.from('lists').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
