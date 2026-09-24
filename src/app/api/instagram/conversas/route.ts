import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Caixa de entrada do Instagram: as conversas mais recentes primeiro. */
export async function GET(req: Request) {
  const conta = new URL(req.url).searchParams.get('conta');
  let q = createServerClient()
    .from('ig_conversas')
    .select('*')
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
    .limit(200);
  if (conta) q = q.eq('conta_id', conta);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversas: data ?? [] });
}
