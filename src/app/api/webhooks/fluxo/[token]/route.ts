import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { iniciarFluxo } from '@/lib/automacao/motor';
import { escolherConexaoOficial } from '@/lib/automacao/servidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Gatilho "Webhook externo": um sistema de fora (o formulário da LP, o n8n, o Bitrix)
 * pede para começar um fluxo para um telefone.
 *
 *   POST /api/webhooks/fluxo/<token>
 *   { "telefone": "11999998888", "nome": "Maria", "email": "…",
 *     "tags": ["lead-lp-japao"], "campos": { "destino": "Japão" } }
 *
 * O token na URL é a credencial (gerado na tela, um por gatilho). Como quem chama
 * aqui quase nunca teve conversa aberta, o fluxo deve COMEÇAR por um bloco Template —
 * texto livre fora da janela de 24 h a Meta recusa.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{24,64}$/.test(token)) return NextResponse.json({ error: 'token inválido' }, { status: 404 });

  let corpo: Record<string, unknown>;
  try {
    corpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const db = createServerClient();
  const { data: gatilho } = await db
    .from('fluxo_gatilhos')
    .select('id,fluxo_id,ativo,fluxos(status,connection_id)')
    .eq('tipo', 'webhook')
    .eq('config->>token', token)
    .maybeSingle();
  const fluxo = (gatilho?.fluxos ?? null) as { status?: string; connection_id?: string | null } | null;
  if (!gatilho) return NextResponse.json({ error: 'gatilho não encontrado' }, { status: 404 });
  if (!gatilho.ativo || fluxo?.status !== 'ativo') {
    return NextResponse.json({ ok: false, motivo: 'fluxo ou gatilho desligado' }, { status: 409 });
  }

  const escolha = await escolherConexaoOficial(db, fluxo?.connection_id ?? null);
  if ('erro' in escolha) return NextResponse.json({ error: escolha.erro }, { status: 503 });

  const campos =
    corpo.campos && typeof corpo.campos === 'object' ? (corpo.campos as Record<string, unknown>) : undefined;
  const tags = Array.isArray(corpo.tags) ? corpo.tags.map(String) : undefined;
  const r = await iniciarFluxo(db, {
    fluxoId: gatilho.fluxo_id as string,
    conexao: escolha.conexao,
    waId: String(corpo.telefone ?? corpo.phone ?? ''),
    nome: corpo.nome ? String(corpo.nome) : null,
    gatilhoId: gatilho.id as string,
    dadosContato: { email: corpo.email ? String(corpo.email) : null, tags, campos },
  });
  if (r.erro) return NextResponse.json({ ok: false, error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, execucao: r.execucaoId });
}
