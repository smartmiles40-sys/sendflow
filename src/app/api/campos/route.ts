import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { normalizarTexto } from '@/lib/automacao/montar';

export const dynamic = 'force-dynamic';

const TIPOS = ['texto', 'numero', 'data', 'sim_nao', 'email', 'telefone'];
/** Chaves que já são colunas do contato ou variáveis do sistema. */
const RESERVADAS = new Set(['nome', 'primeiro_nome', 'email', 'telefone', 'empresa', 'tags']);

export async function GET() {
  const { data, error } = await createServerClient().from('contact_fields').select('*').order('rotulo');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campos: data ?? [] });
}

/** Cria um campo personalizado. A chave sai do rótulo: "Destino favorito" → destino_favorito. */
export async function POST(req: Request) {
  const parsed = await readJson<{ rotulo?: unknown; chave?: unknown; tipo?: unknown; descricao?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const rotulo = String(parsed.data.rotulo ?? '').trim();
  if (!rotulo) return NextResponse.json({ error: 'Dê um nome ao campo.' }, { status: 400 });
  const chave = normalizarTexto(String(parsed.data.chave ?? '') || rotulo)
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(chave)) return NextResponse.json({ error: 'Nome inválido para campo.' }, { status: 400 });
  if (RESERVADAS.has(chave)) return NextResponse.json({ error: `"${chave}" já existe no contato.` }, { status: 400 });
  const tipo = TIPOS.includes(String(parsed.data.tipo)) ? String(parsed.data.tipo) : 'texto';

  const { data, error } = await createServerClient()
    .from('contact_fields')
    .insert({ chave, rotulo: rotulo.slice(0, 60), tipo, descricao: String(parsed.data.descricao ?? '').trim() || null })
    .select()
    .single();
  if (error) {
    const dup = (error as { code?: string }).code === '23505';
    return NextResponse.json({ error: dup ? 'Já existe um campo com esse nome.' : error.message }, { status: dup ? 409 : 500 });
  }
  return NextResponse.json({ campo: data }, { status: 201 });
}
