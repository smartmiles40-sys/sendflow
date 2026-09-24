import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { validarRegras } from '@/lib/segmentos';

export const dynamic = 'force-dynamic';

/** Segmentos salvos, cada um com quantos contatos casam AGORA (o número muda com a base). */
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase.from('segments').select('*').order('nome', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const comTotal = await Promise.all(
    (data ?? []).map(async (s) => {
      const { data: r } = await supabase.rpc('sf_filtrar_contatos', { p_regras: s.regras, p_limite: 1, p_offset: 0 });
      const linha = ((r ?? []) as { total: number }[])[0];
      return { ...s, total: linha ? Number(linha.total) : 0 };
    }),
  );
  return NextResponse.json({ segmentos: comTotal });
}

export async function POST(req: Request) {
  const parsed = await readJson<{ nome?: unknown; descricao?: unknown; regras?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const nome = String(parsed.data.nome ?? '').trim();
  if (!nome) return NextResponse.json({ error: 'Dê um nome ao segmento.' }, { status: 400 });
  const v = validarRegras(parsed.data.regras);
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  if (!v.regras.condicoes.length) return NextResponse.json({ error: 'Adicione pelo menos uma condição.' }, { status: 400 });

  const supabase = createServerClient();
  // Confere no banco antes de gravar: um segmento salvo que o banco não entende quebraria
  // a campanha que o usar, lá na frente.
  const { error: e1 } = await supabase.rpc('sf_filtrar_contatos', { p_regras: v.regras, p_limite: 1, p_offset: 0 });
  if (e1) return NextResponse.json({ error: `O banco recusou as regras: ${e1.message}` }, { status: 400 });

  const { data, error } = await supabase
    .from('segments')
    .insert({ nome, descricao: String(parsed.data.descricao ?? '').trim() || null, regras: v.regras })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
