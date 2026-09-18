import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { listarConversasBrutas } from '@/lib/whatsapp/evolution';
import { paraConversa, type Conversa } from '@/lib/whatsapp/conversas';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';

/**
 * A lista de conversas do número, como no WhatsApp Web, mais uma marca em cada uma que
 * o SendFlow usa (grupo cadastrado ou destino de campanha) — é o filtro "só os meus
 * disparos", que separa o que a equipe quer acompanhar das conversas do dia a dia.
 */
export async function GET(req: Request) {
  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, new URL(req.url).searchParams.get('conexao'));
  if ('res' in aberta) return aberta.res;
  const { conexao } = aberta;

  let brutas: unknown[];
  try {
    brutas = await listarConversasBrutas(conexao.instance_name);
  } catch (e) {
    return respostaDeErro(e);
  }

  const [{ data: grupos }, { data: agendadas }] = await Promise.all([
    supabase.from('groups').select('group_id,nome,ativo'),
    supabase.from('campaigns').select('group_ids,audience_id,alvo').in('status', ['agendada', 'enviando']),
  ]);
  const nomes = new Map((grupos ?? []).map((g) => [g.group_id as string, g.nome as string]));
  const ativos = new Set((grupos ?? []).filter((g) => g.ativo).map((g) => g.group_id as string));

  const conversas = brutas
    .map((b) => paraConversa(b, nomes))
    .filter((c): c is Conversa => c !== null)
    .map((c) => ({
      ...c,
      sendflow: c.grupo ? nomes.has(c.jid) : false,
      ativo: ativos.has(c.jid),
      // Campanha na fila citando este grupo pelo nome. (Público salvo e "todos" ficam de
      // fora desta marca rápida; a conversa aberta mostra a fila completa.)
      naFila: (agendadas ?? []).some((a) => Array.isArray(a.group_ids) && a.group_ids.includes(c.jid)),
    }))
    .sort((a, b) => (b.ultima?.ts ?? 0) - (a.ultima?.ts ?? 0));

  return NextResponse.json({
    conexao: { id: conexao.id, nome: conexao.nome, numero: conexao.numero },
    conversas,
  });
}
