import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { carregarPainel } from '@/lib/painel';

export const dynamic = 'force-dynamic';

/**
 * Tudo que o painel mostra, numa resposta só. Usado quando o cliente troca o período
 * — a primeira carga vem renderizada do servidor, pela mesma função.
 */
export async function GET(req: Request) {
  const dias = Number(new URL(req.url).searchParams.get('dias') ?? 30) || 30;
  const supabase = createServerClient();
  return NextResponse.json(await carregarPainel(supabase, dias));
}
