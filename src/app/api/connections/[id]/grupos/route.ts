import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { EvolutionError, listarGrupos } from '@/lib/whatsapp/evolution';
import { normalizarDestino } from '@/lib/whatsapp/jid';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';
// A Evolution pode demorar para varrer dezenas de grupos.
export const maxDuration = 60;

/**
 * Sincroniza os grupos deste número.
 *
 * É o fim do fluxo mais ingrato do sistema antigo: alguém tinha que abrir o WhatsApp
 * Web, achar o ID de cada grupo e colar na mão, um por um. Aqui o próprio número lista
 * os grupos de que participa.
 *
 * Regras da sincronização, todas deliberadas:
 *   • grupo novo entra DESATIVADO. Sincronizar não pode virar "agora disparo para 60
 *     grupos que nunca escolhi" — quem ativa é a pessoa, grupo a grupo.
 *   • grupo já cadastrado tem só o nome e a contagem atualizados; o `ativo` é da pessoa.
 *   • grupo que sumiu do WhatsApp (saíram, foi apagado) é marcado inativo, nunca
 *     apagado: o histórico de campanhas aponta para ele.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data } = await supabase.from('connections').select('*').eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  const conexao = data as Connection;

  if (conexao.status !== 'conectada') {
    return NextResponse.json(
      { error: 'Conecte o número antes de sincronizar os grupos.' },
      { status: 409 },
    );
  }

  let grupos;
  try {
    grupos = await listarGrupos(conexao.instance_name);
  } catch (e) {
    const erro = e instanceof EvolutionError ? e : new EvolutionError(String(e));
    await supabase
      .from('connections')
      .update({ ultimo_erro: erro.message.slice(0, 500) })
      .eq('id', id);
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }

  const { data: existentes } = await supabase
    .from('groups')
    .select('id,group_id,ativo')
    .eq('connection_id', id);
  const porGroupId = new Map(
    ((existentes ?? []) as { id: string; group_id: string; ativo: boolean }[]).map((g) => [
      normalizarDestino(g.group_id),
      g,
    ]),
  );

  const agora = new Date().toISOString();
  const novos: Record<string, unknown>[] = [];
  const vistos = new Set<string>();
  let atualizados = 0;

  for (const g of grupos) {
    const groupId = normalizarDestino(g.groupId);
    if (!groupId) continue;
    vistos.add(groupId);
    const atual = porGroupId.get(groupId);
    if (atual) {
      await supabase
        .from('groups')
        .update({
          nome: g.nome,
          participantes: g.participantes,
          foto_url: g.fotoUrl,
          sincronizado_em: agora,
        })
        .eq('id', atual.id);
      atualizados += 1;
    } else {
      novos.push({
        group_id: groupId,
        nome: g.nome,
        ativo: false,
        connection_id: id,
        participantes: g.participantes,
        foto_url: g.fotoUrl,
        sincronizado_em: agora,
      });
    }
  }

  if (novos.length) {
    const { error } = await supabase.from('groups').insert(novos);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sumidos = [...porGroupId.entries()].filter(([gid]) => !vistos.has(gid));
  for (const [, g] of sumidos) {
    if (g.ativo) await supabase.from('groups').update({ ativo: false }).eq('id', g.id);
  }

  await supabase
    .from('connections')
    .update({ ultima_sincronizacao: agora, ultimo_erro: null })
    .eq('id', id);

  return NextResponse.json({
    total: grupos.length,
    novos: novos.length,
    atualizados,
    sumidos: sumidos.length,
  });
}
