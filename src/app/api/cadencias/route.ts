import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { lerCategoria, lerDestino } from '@/lib/cadencia';

export const dynamic = 'force-dynamic';

/** Lista as cadências com um resumo dos passos: quantos, quantos já saíram e o próximo. */
export async function GET() {
  const supabase = createServerClient();
  const [{ data: cadencias, error }, { data: passos, error: erroPassos }] = await Promise.all([
    supabase.from('cadencias').select('*').order('criado_em', { ascending: false }),
    supabase
      .from('campaigns')
      .select('cadencia_id,status,enviar_em')
      .not('cadencia_id', 'is', null),
  ]);
  if (error || erroPassos) {
    return NextResponse.json({ error: (error ?? erroPassos)?.message }, { status: 500 });
  }

  const agora = Date.now();
  const lista = (cadencias ?? []).map((c) => {
    const meus = (passos ?? []).filter((p) => p.cadencia_id === c.id);
    const proximo = meus
      .filter((p) => p.status === 'agendada' && p.enviar_em && new Date(p.enviar_em).getTime() >= agora - 60_000)
      .map((p) => p.enviar_em as string)
      .sort()[0];
    return {
      ...c,
      total_passos: meus.length,
      enviados: meus.filter((p) => p.status === 'enviada').length,
      proximo_envio: proximo ?? null,
    };
  });
  return NextResponse.json(lista);
}

export async function POST(req: Request) {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const nome = String(body.nome ?? '').trim();
  const { destino, errors } = lerDestino(body);
  if (!nome) errors.unshift({ field: 'nome', message: 'Dê um nome à cadência.' });
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('cadencias')
    .insert({ nome, categoria: lerCategoria(body.categoria), ...destino })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
