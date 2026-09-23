import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { iniciarFluxo } from '@/lib/automacao/motor';
import { escolherConexaoOficial } from '@/lib/automacao/servidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Inicia o fluxo para um número — o "Testar no meu WhatsApp" do editor e o "Iniciar
 * fluxo" da caixa de conversa. Rascunho também roda aqui, de propósito: é para testar
 * antes de ativar.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ telefone?: unknown; connectionId?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const db = createServerClient();
  const { data: fluxo } = await db.from('fluxos').select('id,connection_id').eq('id', id).maybeSingle();
  if (!fluxo) return NextResponse.json({ error: 'Fluxo não encontrado.' }, { status: 404 });

  const escolha = await escolherConexaoOficial(
    db,
    parsed.data.connectionId ? String(parsed.data.connectionId) : (fluxo.connection_id as string | null),
  );
  if ('erro' in escolha) return NextResponse.json({ error: escolha.erro }, { status: 400 });

  const r = await iniciarFluxo(db, {
    fluxoId: id,
    conexao: escolha.conexao,
    waId: String(parsed.data.telefone ?? ''),
  });
  if (r.erro || !r.execucaoId) return NextResponse.json({ error: r.erro ?? 'Não iniciou.' }, { status: 400 });

  const { data: exec } = await db
    .from('fluxo_execucoes')
    .select('estado,erro,no_atual')
    .eq('id', r.execucaoId)
    .maybeSingle();
  return NextResponse.json({ ok: true, execucao: exec });
}
