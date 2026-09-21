import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { CORES_DE_TAG, corValida, validarNomeTag } from '@/lib/tags';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase.from('group_tags').select('*').order('nome');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const parsed = await readJson<{ nome?: unknown; cor?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const v = validarNomeTag(parsed.data.nome);
  if ('erro' in v) return NextResponse.json({ error: v.erro }, { status: 400 });

  const supabase = createServerClient();
  let cor = parsed.data.cor;
  if (!corValida(cor)) {
    // Sem cor escolhida: a próxima da paleta, para tags vizinhas não saírem iguais.
    const { count } = await supabase.from('group_tags').select('id', { count: 'exact', head: true });
    cor = CORES_DE_TAG[(count ?? 0) % CORES_DE_TAG.length];
  }
  const { data, error } = await supabase
    .from('group_tags')
    .insert({ nome: v.nome, cor })
    .select()
    .single();
  if (error) {
    const duplicada = error.code === '23505';
    return NextResponse.json(
      { error: duplicada ? `Já existe uma tag chamada “${v.nome}”.` : error.message },
      { status: duplicada ? 409 : 500 },
    );
  }
  return NextResponse.json(data, { status: 201 });
}
