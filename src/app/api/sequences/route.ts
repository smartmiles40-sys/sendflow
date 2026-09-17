import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { isCategoria } from '@/lib/categories';

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('sequences')
    .select('id,nome,categoria,atualizado_em')
    .order('nome', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const parsed = await readJson<{ nome?: unknown; categoria?: unknown; steps?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const nome = String(body.nome ?? '').trim();
  if (!nome) {
    return NextResponse.json({ errors: [{ field: 'nome', message: 'Dê um nome ao roteiro.' }] }, { status: 400 });
  }
  if ('categoria' in body && !isCategoria(body.categoria)) {
    return NextResponse.json({ errors: [{ field: 'categoria', message: 'Categoria inválida.' }] }, { status: 400 });
  }
  if ('steps' in body && body.steps !== undefined && !Array.isArray(body.steps)) {
    return NextResponse.json({ errors: [{ field: 'steps', message: 'steps deve ser uma lista.' }] }, { status: 400 });
  }

  const row = {
    nome,
    categoria: isCategoria(body.categoria) ? body.categoria : 'lives',
    steps: Array.isArray(body.steps) ? body.steps : [],
  };

  const supabase = createServerClient();
  const { data, error } = await supabase.from('sequences').insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
