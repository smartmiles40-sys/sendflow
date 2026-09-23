import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Cópia em rascunho, sem gatilhos — dois fluxos com a mesma palavra-chave brigariam. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServerClient();
  const { data: f } = await db.from('fluxos').select('*').eq('id', id).maybeSingle();
  if (!f) return NextResponse.json({ error: 'Fluxo não encontrado.' }, { status: 404 });
  const { data, error } = await db
    .from('fluxos')
    .insert({
      nome: `${f.nome} (cópia)`.slice(0, 120),
      descricao: f.descricao,
      connection_id: f.connection_id,
      pasta: f.pasta,
      grafo: f.grafo,
      status: 'rascunho',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ fluxo: data }, { status: 201 });
}
