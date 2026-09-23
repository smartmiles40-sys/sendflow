import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Os números em cima de cada bloco do editor: quantas pessoas entraram, quantas
 * receberam, quantas clicaram em cada botão, quantos erros. Mais as execuções
 * recentes, para saber ONDE cada pessoa parou.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServerClient();
  const [{ data: linhas, error }, { data: execs }, { count: ativas }] = await Promise.all([
    db.rpc('sf_estatisticas_fluxo', { p_fluxo: id }),
    db
      .from('fluxo_execucoes')
      .select('id,estado,no_atual,erro,iniciada_em,atualizada_em,acordar_em,conversa_id,wa_conversas(wa_id,nome_perfil)')
      .eq('fluxo_id', id)
      .order('iniciada_em', { ascending: false })
      .limit(50),
    db
      .from('fluxo_execucoes')
      .select('id', { count: 'exact', head: true })
      .eq('fluxo_id', id)
      .in('estado', ['aguardando_resposta', 'aguardando_tempo', 'rodando']),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nos: Record<string, { entrou: number; enviou: number; erro: number; saidas: Record<string, number> }> = {};
  for (const l of (linhas ?? []) as { no_id: string; tipo: string; saida: string; total: number }[]) {
    const n = (nos[l.no_id] ??= { entrou: 0, enviou: 0, erro: 0, saidas: {} });
    const total = Number(l.total);
    if (l.tipo === 'entrou') n.entrou += total;
    else if (l.tipo === 'enviou') n.enviou += total;
    else if (l.tipo === 'erro') n.erro += total;
    else if (l.tipo === 'saida' && l.saida) n.saidas[l.saida] = (n.saidas[l.saida] ?? 0) + total;
  }
  return NextResponse.json({ nos, execucoes: execs ?? [], ativas: ativas ?? 0 });
}
