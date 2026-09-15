// O motor de envio do WhatsApp.
//
// Substitui o dispatcher que vivia no n8n. A diferença de fundo não é "onde roda", é
// COMO roda: o n8n abria um fluxo longo por campanha e, se ele morresse no meio, ninguém
// sabia onde tinha parado. Aqui o estado está inteiro no banco (a fila), e o motor é um
// tick curto, idempotente e interrompível — pode ser chamado de minuto em minuto, duas
// vezes seguidas ou depois de 3 horas parado, que o resultado é o mesmo.
//
// As três garantias que sustentam isso:
//   1. Só se manda uma mensagem depois de VENCER a corrida por ela (update com guarda de
//      status). Dois ticks simultâneos não disparam o mesmo destinatário duas vezes.
//   2. O intervalo anti-bloqueio é estado persistido por conexão, não um sleep em memória.
//   3. Nada fica "enviando" para sempre: linha travada há mais de 15 min volta para a fila.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Audience, Campaign, Connection, Contact, Group } from '../types';
import { montarDestinatarios } from './fanout';
import { dormir, inicioDoDiaSP, liberadaEm, Orcamento, proximoEnvio } from './ritmo';
import { EvolutionError, enviarMensagem, type TipoMensagem } from '../whatsapp/evolution';
import { paginar } from '../supabase/paginar';

/** Tentativas antes de desistir de um destinatário. */
const MAX_TENTATIVAS = 3;
/** Depois disso, uma linha presa em 'enviando' é considerada órfã e volta para a fila. */
const MINUTOS_ATE_ORFA = 15;
/** Custo estimado de uma mensagem (chamada + folga) ao decidir se ainda cabe no tick. */
const CUSTO_ENVIO_MS = 6_000;

export interface ResultadoWhatsApp {
  promovidas: number;
  enviadas: number;
  falhas: number;
  pendentes: number;
  fechadas: number;
  avisos: string[];
}

// ── 1. Campanha agendada cuja hora chegou vira fila ──────────────────────────────

/**
 * Materializa os destinatários das campanhas vencidas.
 *
 * A promoção é uma corrida vencida por um só: `update … where status = 'agendada'`
 * devolve linha para quem chegou primeiro. Quem perde a corrida não recebe nada de
 * volta e simplesmente não faz o fan-out — é o que impede dois ticks simultâneos de
 * criarem a fila em duplicata.
 */
export async function promoverCampanhas(
  supabase: SupabaseClient,
  agora: Date,
  avisos: string[],
): Promise<number> {
  const { data: vencidas, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'agendada')
    .lte('enviar_em', agora.toISOString())
    .order('enviar_em', { ascending: true })
    .limit(50);
  if (error) {
    avisos.push(`Erro ao listar campanhas vencidas: ${error.message}`);
    return 0;
  }
  if (!vencidas?.length) return 0;

  // Conexão de reserva: a primeira conectada, em ordem de cadastro. Só é usada quando
  // nem o grupo nem a campanha apontam uma.
  const { data: conexoes } = await supabase
    .from('connections')
    .select('id')
    .eq('ativo', true)
    .eq('status', 'conectada')
    .order('criado_em', { ascending: true })
    .limit(1);
  const conexaoPadrao = (conexoes?.[0]?.id as string | undefined) ?? null;

  let promovidas = 0;
  for (const bruta of vencidas as Campaign[]) {
    const { data: ganha } = await supabase
      .from('campaigns')
      .update({ status: 'enviando' })
      .eq('id', bruta.id)
      .eq('status', 'agendada')
      .select('*')
      .maybeSingle();
    if (!ganha) continue;

    const campanha = ganha as Campaign;
    const fontes = await carregarFontes(supabase, campanha, conexaoPadrao, avisos);
    const { linhas, avisos: avisosFanout } = montarDestinatarios(campanha, fontes);
    for (const a of avisosFanout) avisos.push(`[${campanha.nome}] ${a}`);

    if (!linhas.length) {
      await supabase
        .from('campaigns')
        .update({
          status: 'erro',
          resultado: {
            total: 0,
            enviados: 0,
            falhas: 0,
            erro: avisosFanout[0] ?? 'Nenhum destinatário para esta campanha.',
          },
        })
        .eq('id', campanha.id);
      continue;
    }

    const semConexao = linhas.filter((l) => !l.connection_id).length;
    if (semConexao === linhas.length) {
      await supabase
        .from('campaigns')
        .update({
          status: 'erro',
          resultado: {
            total: linhas.length,
            enviados: 0,
            falhas: 0,
            erro: 'Nenhum número de WhatsApp conectado para disparar esta campanha.',
          },
        })
        .eq('id', campanha.id);
      avisos.push(`[${campanha.nome}] sem conexão conectada — campanha marcada como erro.`);
      continue;
    }

    // `ignoreDuplicates` faz do fan-out uma operação repetível: reprocessar a mesma
    // campanha não cria destinatário duplicado (índice único campaign_id+destino).
    const { error: insErr } = await supabase
      .from('campaign_recipients')
      .upsert(linhas, { onConflict: 'campaign_id,destino', ignoreDuplicates: true });
    if (insErr) {
      avisos.push(`[${campanha.nome}] erro ao montar a fila: ${insErr.message}`);
      await supabase
        .from('campaigns')
        .update({ status: 'erro', resultado: { total: 0, enviados: 0, falhas: 0, erro: insErr.message } })
        .eq('id', campanha.id);
      continue;
    }

    await supabase
      .from('campaigns')
      .update({ resultado: { total: linhas.length, enviados: 0, falhas: 0 } })
      .eq('id', campanha.id);
    promovidas += 1;
  }
  return promovidas;
}

/** Lê do banco o que o fan-out precisa: grupos, público e contatos das listas. */
async function carregarFontes(
  supabase: SupabaseClient,
  campanha: Campaign,
  conexaoPadrao: string | null,
  avisos: string[],
) {
  const { data: grupos } = await supabase
    .from('groups')
    .select('*')
    .eq('ativo', true)
    .order('criado_em', { ascending: true });

  let audience: Audience | null = null;
  if (campanha.audience_id) {
    const { data } = await supabase
      .from('audiences')
      .select('*')
      .eq('id', campanha.audience_id)
      .maybeSingle();
    audience = (data as Audience | null) ?? null;
  }

  const contatos: Contact[] = [];
  if (campanha.alvo === 'contatos' && campanha.list_ids?.length) {
    const { data: membros, error: mErr } = await paginar<{ contact_id: string }>((de, ate) =>
      supabase
        .from('list_members')
        .select('contact_id')
        .in('list_id', campanha.list_ids as string[])
        .order('contact_id', { ascending: true })
        .range(de, ate),
    );
    if (mErr) avisos.push(`[${campanha.nome}] erro ao ler as listas: ${mErr}`);
    const ids = [...new Set(membros.map((m) => m.contact_id))];
    if (ids.length) {
      // `in` com milhares de ids vira uma URL gigante: o PostgREST recebe tudo pela
      // query string e há limite de tamanho no servidor. Daí os blocos de 300.
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabase
          .from('contacts')
          .select('*')
          .in('id', ids.slice(i, i + 300))
          .eq('status_whatsapp', 'ativo')
          .not('telefone', 'is', null);
        contatos.push(...((data ?? []) as Contact[]));
      }
    }
  }

  return {
    grupos: (grupos ?? []) as Group[],
    audience,
    contatos,
    conexaoPadrao,
  };
}

// ── 2. Destravar o que ficou preso ───────────────────────────────────────────────

/**
 * Devolve para a fila as linhas que ficaram em 'enviando' sem nunca terminar — o
 * rastro de um processo que morreu no meio (deploy, timeout, queda da rede).
 *
 * A guarda `provider_message_id is null` é o que evita reenviar algo que na verdade
 * saiu: se a Evolution chegou a devolver um id, a mensagem foi embora, e a linha vira
 * 'enviado' em vez de voltar para a fila.
 */
export async function recuperarOrfas(supabase: SupabaseClient, agora: Date): Promise<number> {
  const corte = new Date(agora.getTime() - MINUTOS_ATE_ORFA * 60_000).toISOString();

  // Saiu de verdade, só não foi anotado: promove em vez de reenviar.
  await supabase
    .from('campaign_recipients')
    .update({ status: 'enviado', enviado_em: agora.toISOString() })
    .eq('status', 'enviando')
    .lt('atualizado_em', corte)
    .not('provider_message_id', 'is', null);

  const { data } = await supabase
    .from('campaign_recipients')
    .update({ status: 'pendente' })
    .eq('status', 'enviando')
    .lt('atualizado_em', corte)
    .is('provider_message_id', null)
    .lt('tentativas', MAX_TENTATIVAS)
    .select('id');

  // Estourou as tentativas e continua travada: é falha, não fila eterna.
  await supabase
    .from('campaign_recipients')
    .update({ status: 'falha', erro: 'Envio não concluído após várias tentativas.' })
    .eq('status', 'enviando')
    .lt('atualizado_em', corte)
    .is('provider_message_id', null)
    .gte('tentativas', MAX_TENTATIVAS);

  return data?.length ?? 0;
}

// ── 3. Drenar a fila, uma conexão de cada vez ────────────────────────────────────

interface FilaItem {
  id: string;
  campaign_id: string;
  destino: string;
  destino_nome: string | null;
  tentativas: number;
  campaigns: {
    nome: string;
    mensagem: string;
    tipo: TipoMensagem;
    midia_url: string | null;
    mencionar_todos: boolean;
  } | null;
}

/**
 * Esvazia a fila de UMA conexão, respeitando o ritmo dela, até acabar o orçamento
 * de tempo do tick ou a fila.
 */
async function drenarConexao(
  supabase: SupabaseClient,
  conexao: Connection,
  orcamento: Orcamento,
  resultado: ResultadoWhatsApp,
): Promise<void> {
  // Quanto já saiu hoje por este número (limite anti-bloqueio).
  let saldo = Number.POSITIVE_INFINITY;
  if (conexao.limite_diario > 0) {
    const { count } = await supabase
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', conexao.id)
      .gte('enviado_em', inicioDoDiaSP(new Date()));
    saldo = Math.max(0, conexao.limite_diario - (count ?? 0));
    if (saldo === 0) {
      resultado.avisos.push(
        `[${conexao.nome}] limite diário de ${conexao.limite_diario} mensagens atingido.`,
      );
      return;
    }
  }

  let proximoLiberado = conexao.proximo_envio_em;

  while (orcamento.cabe(CUSTO_ENVIO_MS) && saldo > 0) {
    const agora = new Date();

    // Ainda dentro do intervalo anti-bloqueio: espera, se couber no orçamento.
    if (!liberadaEm(proximoLiberado, agora)) {
      const esperaMs = new Date(proximoLiberado as string).getTime() - agora.getTime();
      if (!orcamento.cabe(esperaMs + CUSTO_ENVIO_MS)) return;
      await dormir(esperaMs);
      continue;
    }

    const { data: proximos, error } = await supabase
      .from('campaign_recipients')
      .select(
        'id,campaign_id,destino,destino_nome,tentativas,' +
          'campaigns!inner(nome,mensagem,tipo,midia_url,mencionar_todos,status)',
      )
      .eq('status', 'pendente')
      .eq('connection_id', conexao.id)
      .eq('campaigns.status', 'enviando')
      .order('criado_em', { ascending: true })
      .limit(1);
    if (error) {
      resultado.avisos.push(`[${conexao.nome}] erro ao ler a fila: ${error.message}`);
      return;
    }
    // Cast via `unknown`: o supabase-js não consegue inferir o tipo de um select com
    // recurso embutido escrito como string, e devolve um tipo de erro genérico.
    const item = ((proximos?.[0] ?? null) as unknown) as FilaItem | null;
    if (!item || !item.campaigns) return; // fila vazia para esta conexão

    // A corrida: quem conseguir mudar o status de 'pendente' para 'enviando' é o dono
    // desta mensagem. Os outros ticks recebem null e seguem para a próxima linha.
    const { data: ganha } = await supabase
      .from('campaign_recipients')
      .update({ status: 'enviando', tentativas: item.tentativas + 1 })
      .eq('id', item.id)
      .eq('status', 'pendente')
      .select('id')
      .maybeSingle();
    if (!ganha) continue;

    const campanha = item.campaigns;
    try {
      const envio = await enviarMensagem(conexao.instance_name, {
        destino: item.destino,
        tipo: campanha.tipo,
        texto: campanha.mensagem,
        midiaUrl: campanha.midia_url,
        mencionarTodos: campanha.mencionar_todos,
      });
      await supabase
        .from('campaign_recipients')
        .update({
          status: 'enviado',
          provider_message_id: envio.messageId,
          enviado_em: new Date().toISOString(),
          erro: null,
        })
        .eq('id', item.id);
      resultado.enviadas += 1;
      saldo -= 1;
    } catch (e) {
      const erro = e instanceof EvolutionError ? e : new EvolutionError(String(e));
      // Erro definitivo (número inexistente, instância apagada) ou tentativas esgotadas:
      // vira falha. O resto volta para a fila e o próximo tick tenta de novo.
      const desistir = erro.permanente || item.tentativas + 1 >= MAX_TENTATIVAS;
      await supabase
        .from('campaign_recipients')
        .update({
          status: desistir ? 'falha' : 'pendente',
          erro: erro.message.slice(0, 500),
        })
        .eq('id', item.id);
      if (desistir) resultado.falhas += 1;
      resultado.avisos.push(`[${conexao.nome}] ${item.destino_nome ?? item.destino}: ${erro.message}`);

      // Instância fora do ar derruba a conexão inteira: marca e para de insistir,
      // senão o tick queima o orçamento errando uma mensagem atrás da outra.
      if (erro.status === 404 || erro.status === 401 || erro.status === 403) {
        await supabase
          .from('connections')
          .update({ status: 'erro', ultimo_erro: erro.message.slice(0, 500) })
          .eq('id', conexao.id);
        return;
      }
    }

    // O intervalo vale para o envio e para a falha: se o número está com problema,
    // martelar a API é exatamente o que não se deve fazer.
    proximoLiberado = proximoEnvio(new Date(), conexao.delay_min_seg, conexao.delay_max_seg);
    await supabase
      .from('connections')
      .update({ proximo_envio_em: proximoLiberado })
      .eq('id', conexao.id);
  }
}

// ── 4. Fechar o que terminou ─────────────────────────────────────────────────────

/**
 * Campanha 'enviando' sem nada pendente está encerrada. O status final distingue os
 * dois desfechos: se NENHUMA mensagem saiu, isso é erro (e a tela precisa gritar);
 * se algumas falharam mas a maioria saiu, é uma campanha enviada com falhas.
 */
/** Conta linhas da fila de uma campanha, com `head: true` para não trazer os dados. */
async function contarFila(
  supabase: SupabaseClient,
  campaignId: string,
  status?: string[],
): Promise<number> {
  let q = supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId);
  if (status) q = q.in('status', status);
  const { count } = await q;
  return count ?? 0;
}

export async function fecharCampanhas(
  supabase: SupabaseClient,
  agora: Date,
  avisos: string[],
): Promise<number> {
  const { data: emVoo } = await supabase
    .from('campaigns')
    .select('id,nome')
    .eq('status', 'enviando')
    .limit(100);
  if (!emVoo?.length) return 0;

  let fechadas = 0;
  for (const c of emVoo as { id: string; nome: string }[]) {
    const pendentes = await contarFila(supabase, c.id, ['pendente', 'enviando']);
    if (pendentes > 0) continue;

    const total = await contarFila(supabase, c.id);
    const enviados = await contarFila(supabase, c.id, ['enviado', 'entregue', 'lido']);
    const falhas = await contarFila(supabase, c.id, ['falha']);

    await supabase
      .from('campaigns')
      .update({
        status: enviados === 0 ? 'erro' : 'enviada',
        enviado_em: agora.toISOString(),
        resultado: {
          total,
          enviados,
          falhas,
          ...(enviados === 0 ? { erro: 'Nenhuma mensagem foi entregue ao WhatsApp.' } : {}),
        },
      })
      .eq('id', c.id)
      .eq('status', 'enviando');
    fechadas += 1;
    if (enviados === 0) avisos.push(`[${c.nome}] terminou sem nenhum envio bem-sucedido.`);
  }
  return fechadas;
}

// ── Orquestração ─────────────────────────────────────────────────────────────────

/** Um ciclo completo do motor de WhatsApp. */
export async function rodarWhatsApp(
  supabase: SupabaseClient,
  orcamento: Orcamento,
  agora: Date = new Date(),
): Promise<ResultadoWhatsApp> {
  const resultado: ResultadoWhatsApp = {
    promovidas: 0,
    enviadas: 0,
    falhas: 0,
    pendentes: 0,
    fechadas: 0,
    avisos: [],
  };

  resultado.promovidas = await promoverCampanhas(supabase, agora, resultado.avisos);
  await recuperarOrfas(supabase, agora);

  const { data: conexoes } = await supabase
    .from('connections')
    .select('*')
    .eq('ativo', true)
    .eq('status', 'conectada')
    .order('criado_em', { ascending: true });

  // Conexões em paralelo: dois números disparam ao mesmo tempo, cada um no seu ritmo.
  // O paralelismo é entre NÚMEROS, nunca dentro do mesmo — é o intervalo dentro de uma
  // conexão que protege contra bloqueio.
  await Promise.all(
    ((conexoes ?? []) as Connection[]).map((c) =>
      drenarConexao(supabase, c, orcamento, resultado).catch((e) => {
        resultado.avisos.push(`[${c.nome}] falhou: ${e instanceof Error ? e.message : String(e)}`);
      }),
    ),
  );

  resultado.fechadas = await fecharCampanhas(supabase, agora, resultado.avisos);

  const { count } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pendente', 'enviando']);
  resultado.pendentes = count ?? 0;

  return resultado;
}
