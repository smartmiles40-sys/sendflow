import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { validarGrafo, type Grafo } from '@/lib/automacao/tipos';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const db = createServerClient();
  const [{ data: fluxo }, { data: gatilhos }] = await Promise.all([
    db.from('fluxos').select('*').eq('id', id).maybeSingle(),
    db.from('fluxo_gatilhos').select('*').eq('fluxo_id', id).order('criado_em'),
  ]);
  if (!fluxo) return NextResponse.json({ error: 'Fluxo não encontrado.' }, { status: 404 });
  return NextResponse.json({ fluxo, gatilhos: gatilhos ?? [] });
}

/**
 * Salva o que o editor mandou. Ativar passa pela validação: um fluxo com erro grave
 * (botão sem texto, mensagem vazia, Início solto) não vai ao ar — é melhor a tela
 * recusar do que a Meta recusar com o cliente esperando a resposta.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await readJson<{
    nome?: unknown;
    descricao?: unknown;
    grafo?: unknown;
    status?: unknown;
    connection_id?: unknown;
    pasta?: unknown;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  const db = createServerClient();

  const { data: atual } = await db.from('fluxos').select('grafo,status').eq('id', id).maybeSingle();
  if (!atual) return NextResponse.json({ error: 'Fluxo não encontrado.' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof b.nome === 'string') {
    if (!b.nome.trim()) return NextResponse.json({ error: 'Dê um nome ao fluxo.' }, { status: 400 });
    patch.nome = b.nome.trim().slice(0, 120);
  }
  if (b.descricao !== undefined) patch.descricao = String(b.descricao ?? '').trim() || null;
  if (b.pasta !== undefined) patch.pasta = String(b.pasta ?? '').trim() || null;
  if (b.connection_id !== undefined) patch.connection_id = b.connection_id ? String(b.connection_id) : null;
  if (b.grafo !== undefined) {
    const g = b.grafo as Grafo;
    if (!g || !Array.isArray(g.nos) || !Array.isArray(g.ligacoes)) {
      return NextResponse.json({ error: 'Grafo inválido.' }, { status: 400 });
    }
    if (JSON.stringify(g).length > 900_000) {
      return NextResponse.json(
        { error: 'O fluxo ficou grande demais. Divida em dois com "Ir para outro fluxo".' },
        { status: 400 },
      );
    }
    patch.grafo = g;
  }
  if (b.status !== undefined) {
    if (!['rascunho', 'ativo', 'pausado'].includes(String(b.status))) {
      return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    }
    patch.status = b.status;
  }

  const statusFinal = (patch.status ?? atual.status) as string;
  if (statusFinal === 'ativo') {
    const problemas = validarGrafo((patch.grafo ?? atual.grafo) as Grafo).filter((p) => p.grave);
    if (problemas.length) {
      return NextResponse.json({ error: 'Corrija antes de ativar.', problemas }, { status: 400 });
    }
  }

  const { data, error } = await db.from('fluxos').update(patch).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ fluxo: data });
}

/** Apaga o fluxo, os gatilhos e as execuções (cascade). Quem estava no meio para. */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const { error } = await createServerClient().from('fluxos').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
