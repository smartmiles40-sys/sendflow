import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Registro dos comentários recebidos e do que o robô fez com cada um. */
export async function GET(req: Request) {
  const conta = new URL(req.url).searchParams.get('conta');
  let q = createServerClient()
    .from('ig_comentarios')
    .select('*, ig_automacoes(nome)')
    .order('criado_em', { ascending: false })
    .limit(200);
  if (conta) q = q.eq('conta_id', conta);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comentarios: data ?? [] });
}
