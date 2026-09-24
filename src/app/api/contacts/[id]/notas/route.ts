import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Anotação da equipe na linha do tempo do contato ("ligou pedindo o roteiro do Japão"). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ texto?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const texto = String(parsed.data.texto ?? '').trim();
  if (!texto) return NextResponse.json({ error: 'Escreva a anotação.' }, { status: 400 });
  if (texto.length > 2000) return NextResponse.json({ error: 'Anotação longa demais (máx. 2.000 caracteres).' }, { status: 400 });
  const { data, error } = await createServerClient()
    .from('contact_eventos')
    .insert({ contact_id: id, tipo: 'nota', detalhe: { texto } })
    .select('id,tipo,detalhe,criado_em')
    .single();
  if (error) {
    const naoExiste = error.code === '23503';
    return NextResponse.json({ error: naoExiste ? 'Contato não encontrado.' : error.message }, { status: naoExiste ? 404 : 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
