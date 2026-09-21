import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { listarMensagensBrutas } from '@/lib/whatsapp/evolution';
import { juntarReacoes, lerFixadas, paraBalao, previa, type Balao } from '@/lib/whatsapp/conversas';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';

/**
 * Uma conversa aberta: o histórico real do aparelho, com três coisas que só o SendFlow
 * sabe costuradas por cima —
 *   1. qual balão saiu de qual campanha (pelo id da mensagem no WhatsApp);
 *   2. a mídia original dos nossos envios (a do WhatsApp é cifrada);
 *   3. o que ainda VAI sair para esta conversa (campanhas e cadências na fila), para dar
 *      para corrigir antes de enviar.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jid = (url.searchParams.get('jid') ?? '').trim();
  const pagina = Math.max(1, Number(url.searchParams.get('pagina')) || 1);
  if (!jid) return NextResponse.json({ error: 'Falta a conversa (jid).' }, { status: 400 });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, url.searchParams.get('conexao'));
  if ('res' in aberta) return aberta.res;
  const { conexao } = aberta;

  let lote: { registros: unknown[]; paginas: number };
  try {
    lote = await listarMensagensBrutas(conexao.instance_name, jid, pagina);
  } catch (e) {
    return respostaDeErro(e);
  }

  // A Evolution devolve da mais nova para a mais antiga; o chat lê de cima para baixo.
  const baloes = lote.registros
    .map(paraBalao)
    .filter((b): b is Balao => b !== null)
    .sort((a, b) => a.ts - b.ts);
  // Reação é um registro à parte no WhatsApp; aqui ela vira o selinho embaixo do balão.
  const reacoes = juntarReacoes(lote.registros);
  for (const b of baloes) b.reacoes = reacoes.get(b.id) ?? [];

  // 1 e 2: de qual campanha saiu cada balão nosso.
  const nossos = baloes.filter((b) => b.fromMe).map((b) => b.id);
  const origem: Record<string, { campanha_id: string; campanha: string; midia_url: string | null }> = {};
  if (nossos.length) {
    const { data: filas } = await supabase
      .from('campaign_recipients')
      .select('provider_message_id,campaign_id')
      .in('provider_message_id', nossos);
    const ids = [...new Set((filas ?? []).map((f) => f.campaign_id as string))];
    const { data: camps } = ids.length
      ? await supabase.from('campaigns').select('id,nome,midia_url').in('id', ids)
      : { data: [] };
    for (const f of filas ?? []) {
      const c = (camps ?? []).find((x) => x.id === f.campaign_id);
      if (c && f.provider_message_id) {
        origem[f.provider_message_id] = { campanha_id: c.id, campanha: c.nome, midia_url: c.midia_url };
      }
    }
  }

  // 3: o que está na fila para esta conversa. Só em grupo — em contato individual o
  // destino depende de listas, e a conta não cabe numa tela de leitura.
  let naFila: unknown[] = [];
  if (pagina === 1 && jid.endsWith('@g.us')) {
    const [{ data: camps }, { data: grupo }, { data: publicos }] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id,nome,tipo,mensagem,midia_url,mencionar_todos,enquete_opcoes,enviar_em,status,cadencia_id,group_ids,audience_id,alvo')
        .or('status.in.(agendada,enviando),and(status.eq.rascunho,cadencia_id.not.is.null)')
        .eq('alvo', 'grupos')
        .order('enviar_em', { ascending: true })
        .limit(200),
      supabase.from('groups').select('ativo').eq('group_id', jid).maybeSingle(),
      supabase.from('audiences').select('id,tipo,group_ids'),
    ]);
    const grupoAtivo = Boolean(grupo?.ativo);
    naFila = (camps ?? [])
      .filter((c) => {
        if (Array.isArray(c.group_ids) && c.group_ids.length) return c.group_ids.includes(jid);
        if (c.audience_id) {
          const p = (publicos ?? []).find((x) => x.id === c.audience_id);
          if (!p) return false;
          return p.tipo === 'manual' ? (p.group_ids ?? []).includes(jid) : grupoAtivo;
        }
        return grupoAtivo; // sem grupos e sem público = todos os grupos ativos
      })
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        mensagem: c.mensagem,
        midia_url: c.midia_url,
        mencionar_todos: c.mencionar_todos,
        enquete_opcoes: c.enquete_opcoes,
        enviar_em: c.enviar_em,
        status: c.status,
        cadencia_id: c.cadencia_id,
      }));
  }

  // Fixadas (faixa no topo). Só dá para saber pelo que veio nesta página do histórico; a
  // prévia sai do balão quando ele está na página, senão fica um texto genérico.
  const fixadas =
    pagina === 1
      ? lerFixadas(lote.registros, Math.floor(Date.now() / 1000)).map((f) => {
          const b = baloes.find((x) => x.id === f.id);
          return { ...f, texto: b ? previa(b.tipo, b.texto) || 'Mensagem' : 'Mensagem fixada' };
        })
      : [];

  return NextResponse.json({ baloes, paginas: lote.paginas, pagina, origem, naFila, fixadas });
}
