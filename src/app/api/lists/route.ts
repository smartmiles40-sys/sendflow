import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Listas com a contagem de membros.
 *
 * A contagem vem de uma consulta agregada separada em vez de `lists(count)` embutido:
 * o `count` embutido do PostgREST traz as linhas da relação para contar, e numa lista
 * de 20 mil contatos isso é 20 mil linhas trafegadas para exibir um número.
 */
export async function GET() {
  const supabase = createServerClient();
  const { data: listas, error } = await supabase
    .from('lists')
    .select('*')
    .order('nome', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const comTotal = await Promise.all(
    (listas ?? []).map(async (l) => {
      const { count } = await supabase
        .from('list_members')
        .select('contact_id', { count: 'exact', head: true })
        .eq('list_id', l.id);
      return { ...l, total: count ?? 0 };
    }),
  );

  return NextResponse.json(comTotal);
}

export async function POST(req: Request) {
  const parsed = await readJson<{ nome?: unknown; descricao?: unknown; cor?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const nome = String(body.nome ?? '').trim();
  if (!nome) {
    return NextResponse.json({ errors: [{ field: 'nome', message: 'Dê um nome à lista.' }] }, { status: 400 });
  }
  const cor = String(body.cor ?? '#D7F264');

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('lists')
    .insert({
      nome,
      descricao: String(body.descricao ?? '').trim() || null,
      cor: /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : '#D7F264',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, total: 0 }, { status: 201 });
}
