import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { grafoInicial, type Grafo } from '@/lib/automacao/tipos';
import { MODELOS } from '@/lib/automacao/modelos';

export const dynamic = 'force-dynamic';

/** Lista os fluxos com os gatilhos de cada um (a tela mostra "como ele começa"). */
export async function GET() {
  const db = createServerClient();
  const [{ data: fluxos, error }, { data: gatilhos }] = await Promise.all([
    db
      .from('fluxos')
      .select('id,nome,descricao,connection_id,status,pasta,execucoes_total,concluidas_total,criado_em,atualizado_em')
      .order('atualizado_em', { ascending: false }),
    db.from('fluxo_gatilhos').select('*, fluxos(nome,status)').order('prioridade', { ascending: false }),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ fluxos: fluxos ?? [], gatilhos: gatilhos ?? [] });
}

/** Cria um fluxo: em branco ou a partir de um modelo pronto. */
export async function POST(req: Request) {
  const parsed = await readJson<{ nome?: unknown; modelo?: unknown; descricao?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const modelo = MODELOS.find((m) => m.id === parsed.data.modelo) ?? null;
  const nome = String(parsed.data.nome ?? '').trim() || modelo?.nome || 'Novo fluxo';
  const grafo: Grafo = modelo ? modelo.grafo() : grafoInicial();

  const db = createServerClient();
  const { data, error } = await db
    .from('fluxos')
    .insert({
      nome: nome.slice(0, 120),
      descricao: String(parsed.data.descricao ?? modelo?.descricao ?? '').trim() || null,
      grafo,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // O gatilho do modelo nasce DESLIGADO: ativar é decisão de quem revisou o texto.
  if (modelo?.gatilho) {
    await db
      .from('fluxo_gatilhos')
      .insert({ fluxo_id: data.id, tipo: modelo.gatilho.tipo, config: modelo.gatilho.config, ativo: false });
  }
  return NextResponse.json({ fluxo: data }, { status: 201 });
}
