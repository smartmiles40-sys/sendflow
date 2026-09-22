// O motor de envio do WhatsApp — agora com DOIS conectores.
//
// O desenho de fundo não mudou desde a primeira versão, e é ele que sustenta o resto:
// o estado está inteiro no banco (a fila), e o motor é um tick curto, idempotente e
// interrompível. Pode ser chamado de minuto em minuto, duas vezes seguidas ou depois
// de três horas parado, que o resultado é o mesmo.
//
// O que mudou na sprint de 22/09/2026 foi o RITMO, porque passaram a existir dois
// canais com naturezas opostas:
//
//   Grupos, pela Evolution          Massa 1-a-1, pela API oficial
//   ──────────────────────────      ────────────────────────────────────────────
//   uma mensagem por vez            lotes em paralelo
//   8–15 s de intervalo             dezenas por segundo
//   ~500/dia antes do bloqueio      milhares/dia conforme o tier
//   estado por conexão no banco     limite de ritmo devolvido pela própria Meta
//
// Por isso `drenarEvolution` e `drenarCloud` são funções separadas em vez de um `if`
// no meio de um laço só: são duas estratégias, não duas variações.
//
// As garantias continuam valendo para os dois:
//   1. Só se manda depois de VENCER a corrida pela linha (guarda de status na Evolution,
//      `for update skip locked` no lote da Cloud API).
//   2. Nada fica "enviando" para sempre: linha travada há mais de 15 min volta à fila.
//   3. Campanha só é dada por encerrada quando a fila dela terminou de ser MONTADA.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Audience, Campaign, Connection, Contact, Group } from '../types';
import { montarDestinatarios, montarLinhasDeContatos } from './fanout';
import { dentroDaJanela, dormir, inicioDoDiaSP, liberadaEm, Orcamento, proximoEnvio } from './ritmo';
import { EvolutionError, enviarMensagem, type TipoMensagem } from '../whatsapp/evolution';
import { CloudError, enviarTemplate, type TipoCabecalho } from '../whatsapp/cloud';

/** Tentativas antes de desistir de um destinatário. */
const MAX_TENTATIVAS = 3;
/** Depois disso, uma linha presa em 'enviando' é considerada órfã e volta para a fila. */
const MINUTOS_ATE_ORFA = 15;
/** Custo estimado de uma mensagem pela Evolution (chamada + folga). */
const CUSTO_ENVIO_MS = 6_000;
/** Custo estimado de um lote da Cloud API: a rajada em paralelo mais o respiro de 1 s. */
const CUSTO_LOTE_MS = 3_000;
/** Contatos lidos por página no fan-out em fatias. */
const PAGINA_FANOUT = 1_000;
/** Teto de páginas por tick, para o fan-out não comer o orçamento do envio inteiro. */
const PAGINAS_POR_TICK = 25;

export interface ResultadoWhatsApp {
  promovidas: number;
  enviadas: number;
  falhas: number;
  pendentes: number;
  fechadas: number;
  /** Linhas acrescentadas à fila neste tick pelo fan-out em fatias. */
  enfileiradas: number;
  avisos: string[];
}

/** As chaves de `app_settings.envio` que o motor passou a LER (ver 0019). */
export interface ConfigEnvio {
  janela_inicio: string;
  janela_fim: string;
  respeitar_janela: boolean;
  lote_whatsapp: number;
}

const ENVIO_PADRAO: ConfigEnvio = {
  janela_inicio: '08:00',
  janela_fim: '21:00',
  respeitar_janela: false,
  lote_whatsapp: 200,
};

/**
 * Lê a janela de horário e o lote. Até a 0018 estas chaves eram escritas pela tela
 * Configurações e IGNORADAS por todo mundo — um agendamento errado disparava às 3 h da
 * manhã e a configuração que deveria impedir isso era código morto.
 */
export async function lerConfigEnvio(supabase: SupabaseClient): Promise<ConfigEnvio> {
  const { data } = await supabase
    .from('app_settings')
    .select('valor')
    .eq('chave', 'envio')
    .maybeSingle();
  const v = (data?.valor ?? {}) as Partial<ConfigEnvio>;
  const lote = Number(v.lote_whatsapp);
  return {
    janela_inicio: String(v.janela_inicio ?? ENVIO_PADRAO.janela_inicio),
    janela_fim: String(v.janela_fim ?? ENVIO_PADRAO.janela_fim),
    respeitar_janela: Boolean(v.respeitar_janela),
    lote_whatsapp:
      Number.isFinite(lote) && lote > 0 ? Math.min(500, Math.floor(lote)) : ENVIO_PADRAO.lote_whatsapp,
  };
}

// ── 1. Campanha agendada cuja hora chegou vira fila ──────────────────────────────

/**
 * Materializa os destinatários das campanhas vencidas.
 *
 * A promoção é uma corrida vencida por um só: `update … where status = 'agendada'`
 * devolve linha para quem chegou primeiro. Quem perde a corrida não recebe nada de
 * volta e simplesmente não faz o fan-out — é o que impede dois ticks simultâneos de
 * criarem a fila em duplicata.
 *
 * Campanha de GRUPO vira fila aqui mesmo: são dezenas de linhas, cabem na memória.
 * Campanha de CONTATOS só é marcada para o fan-out em fatias — podem ser 50 mil.
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

  // Conexão de reserva para GRUPOS: a primeira instância conectada, em ordem de
  // cadastro. Campanha de contatos não tem reserva — ela exige uma conexão da API
  // oficial escolhida na tela, e escolher uma "qualquer" seria disparar em massa pelo
  // número errado.
  const { data: conexoes } = await supabase
    .from('connections')
    .select('id')
    .eq('ativo', true)
    .eq('provider', 'evolution')
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

    if (campanha.alvo === 'contatos') {
      const pronta = await abrirFanoutDeContatos(supabase, campanha, avisos);
      if (pronta) promovidas += 1;
      continue;
    }

    const fontes = await carregarFontes(supabase, campanha, conexaoPadrao);
    const { linhas, avisos: avisosFanout } = montarDestinatarios(campanha, fontes);
    for (const a of avisosFanout) avisos.push(`[${campanha.nome}] ${a}`);

    if (!linhas.length) {
      await marcarErro(supabase, campanha.id, avisosFanout[0] ?? 'Nenhum destinatário para esta campanha.');
      continue;
    }

    const semConexao = linhas.filter((l) => !l.connection_id).length;
    if (semConexao === linhas.length) {
      await marcarErro(
        supabase,
        campanha.id,
        'Nenhum número de WhatsApp conectado para disparar esta campanha.',
        linhas.length,
      );
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
      await marcarErro(supabase, campanha.id, insErr.message);
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

async function marcarErro(
  supabase: SupabaseClient,
  campaignId: string,
  erro: string,
  total = 0,
): Promise<void> {
  await supabase
    .from('campaigns')
    .update({
      status: 'erro',
      fanout_completo: true,
      resultado: { total, enviados: 0, falhas: 0, erro },
    })
    .eq('id', campaignId);
}

/**
 * Abre o fan-out em fatias de uma campanha de contatos.
 *
 * Aqui é onde a REGRA do sistema é aplicada pelo motor: disparo em massa só sai por
 * conexão da API oficial. A tela e o trigger do banco já barram isso antes, mas uma
 * campanha pode ter sido agendada ONTEM, com a conexão certa, e a conexão ter sido
 * trocada para um chip hoje de manhã. O motor confere na hora de disparar.
 */
async function abrirFanoutDeContatos(
  supabase: SupabaseClient,
  campanha: Campaign,
  avisos: string[],
): Promise<boolean> {
  if (!campanha.connection_id) {
    await marcarErro(supabase, campanha.id, 'Disparo em massa exige um número da API oficial.');
    return false;
  }

  const { data: conexao } = await supabase
    .from('connections')
    .select('id,nome,provider,status')
    .eq('id', campanha.connection_id)
    .maybeSingle();

  if (!conexao || (conexao as Connection).provider !== 'cloud') {
    await marcarErro(
      supabase,
      campanha.id,
      'Disparo em massa para contatos só sai pela API oficial do WhatsApp. A conexão desta campanha não é da API oficial.',
    );
    avisos.push(`[${campanha.nome}] recusada: disparo em massa por chip não é permitido.`);
    return false;
  }

  if (!campanha.template_nome) {
    await marcarErro(supabase, campanha.id, 'Disparo em massa exige um template aprovado pela Meta.');
    return false;
  }

  if (!campanha.list_ids?.length) {
    await marcarErro(supabase, campanha.id, 'Nenhuma lista de contatos selecionada.');
    return false;
  }

  await supabase
    .from('campaigns')
    .update({
      fanout_completo: false,
      fanout_cursor: null,
      resultado: { total: 0, enviados: 0, falhas: 0 },
    })
    .eq('id', campanha.id);
  return true;
}

/** Lê do banco o que o fan-out de GRUPOS precisa: grupos e público. */
async function carregarFontes(
  supabase: SupabaseClient,
  campanha: Campaign,
  conexaoPadrao: string | null,
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

  // Contatos NÃO são carregados aqui. Campanha de contatos é disparo em massa e segue
  // pelo fan-out em fatias (`continuarFanout`), que lê de mil em mil — carregar 50 mil
  // contatos nesta função era exatamente o que estourava a memória do tick.
  return { grupos: (grupos ?? []) as Group[], audience, contatos: [] as Contact[], conexaoPadrao };
}

// ── 2. Fan-out em fatias (contatos) ──────────────────────────────────────────────

/**
 * Continua montando a fila das campanhas de contatos, de mil em mil.
 *
 * Por que em fatias, e não de uma vez: uma campanha para 50 mil contatos carregaria 50
 * mil linhas na memória de uma função serverless de 60 s e mandaria um corpo de vários
 * megabytes ao PostgREST. As duas coisas falham, e falham TARDE — com a campanha já
 * marcada como 'enviando'.
 *
 * O cursor é o `contact_id` da última linha lida. Ele funciona porque a leitura é
 * ordenada por `contact_id`: retomar é continuar de onde parou, e reprocessar uma
 * página por acidente não duplica nada (o upsert ignora conflito).
 */
export async function continuarFanout(
  supabase: SupabaseClient,
  orcamento: Orcamento,
  avisos: string[],
): Promise<number> {
  const { data: abertas } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'enviando')
    .eq('fanout_completo', false)
    .order('enviar_em', { ascending: true })
    .limit(5);
  if (!abertas?.length) return 0;

  let enfileiradas = 0;

  for (const campanha of abertas as Campaign[]) {
    if (!orcamento.cabe(CUSTO_LOTE_MS)) break;
    if (!campanha.list_ids?.length) continue;

    const variaveisDoTemplate = await contarVariaveisDoTemplate(supabase, campanha);
    // O dedupe por telefone vale dentro de UMA campanha. `vistos` é recriado a cada
    // tick e não atravessa retomadas — quem garante a unicidade de verdade é o índice
    // único (campaign_id, destino) no banco, e o upsert que ignora o conflito.
    const vistos = new Set<string>();
    let cursor = campanha.fanout_cursor ?? '';
    let paginas = 0;
    let terminou = false;

    while (paginas < PAGINAS_POR_TICK && orcamento.cabe(CUSTO_LOTE_MS)) {
      let q = supabase
        .from('list_members')
        .select('contact_id')
        .in('list_id', campanha.list_ids as string[])
        .order('contact_id', { ascending: true })
        .limit(PAGINA_FANOUT);
      if (cursor) q = q.gt('contact_id', cursor);

      const { data: membros, error: mErr } = await q;
      if (mErr) {
        avisos.push(`[${campanha.nome}] erro ao ler as listas: ${mErr.message}`);
        break;
      }
      if (!membros?.length) {
        terminou = true;
        break;
      }

      const ids = [...new Set((membros as { contact_id: string }[]).map((m) => m.contact_id))];
      cursor = ids[ids.length - 1];

      const { data: contatos, error: cErr } = await supabase
        .from('contacts')
        .select('id,nome,telefone,email,empresa,campos,status_whatsapp')
        .in('id', ids)
        .eq('status_whatsapp', 'ativo')
        .not('telefone', 'is', null);
      if (cErr) {
        avisos.push(`[${campanha.nome}] erro ao ler contatos: ${cErr.message}`);
        break;
      }

      const { linhas } = montarLinhasDeContatos(
        campanha,
        (contatos ?? []) as Contact[],
        campanha.connection_id,
        { variaveisDoTemplate, vistos },
      );

      for (let i = 0; i < linhas.length; i += 500) {
        const fatia = linhas.slice(i, i + 500);
        const { error: insErr } = await supabase
          .from('campaign_recipients')
          .upsert(fatia, { onConflict: 'campaign_id,destino', ignoreDuplicates: true });
        if (insErr) {
          avisos.push(`[${campanha.nome}] erro ao montar a fila: ${insErr.message}`);
          terminou = true;
          break;
        }
        enfileiradas += fatia.length;
      }

      // Página incompleta é o fim da lista: não há mais o que ler.
      if ((membros as unknown[]).length < PAGINA_FANOUT) terminou = true;

      // O cursor é gravado a CADA página. Se o tick for cortado no meio, o próximo
      // retoma daqui — sem isso, uma campanha grande recomeçaria do zero para sempre.
      await supabase.from('campaigns').update({ fanout_cursor: cursor }).eq('id', campanha.id);

      paginas += 1;
      if (terminou) break;
    }

    if (terminou) {
      const total = await contarFila(supabase, campanha.id);
      if (total === 0) {
        await marcarErro(
          supabase,
          campanha.id,
          'Nenhum contato com WhatsApp ativo nas listas escolhidas.',
        );
      } else {
        await supabase
          .from('campaigns')
          .update({ fanout_completo: true, resultado: { total, enviados: 0, falhas: 0 } })
          .eq('id', campanha.id);
      }
    }
  }

  return enfileiradas;
}

/** Quantas variáveis o template desta campanha pede. Zero quando não há template. */
async function contarVariaveisDoTemplate(
  supabase: SupabaseClient,
  campanha: Campaign,
): Promise<number> {
  if (!campanha.template_nome || !campanha.connection_id) return 0;
  const { data } = await supabase
    .from('whatsapp_templates')
    .select('variaveis_corpo')
    .eq('connection_id', campanha.connection_id)
    .eq('nome', campanha.template_nome)
    .eq('idioma', campanha.template_idioma ?? 'pt_BR')
    .maybeSingle();
  return Number(data?.variaveis_corpo ?? 0);
}

// ── 3. Destravar o que ficou preso ───────────────────────────────────────────────

/**
 * Devolve para a fila as linhas que ficaram em 'enviando' sem nunca terminar — o
 * rastro de um processo que morreu no meio (deploy, timeout, queda da rede).
 *
 * A guarda `provider_message_id is null` é o que evita reenviar algo que na verdade
 * saiu: se a API chegou a devolver um id, a mensagem foi embora, e a linha vira
 * 'enviado' em vez de voltar para a fila.
 */
export async function recuperarOrfas(supabase: SupabaseClient, agora: Date): Promise<number> {
  const corte = new Date(agora.getTime() - MINUTOS_ATE_ORFA * 60_000).toISOString();

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

  await supabase
    .from('campaign_recipients')
    .update({ status: 'falha', erro: 'Envio não concluído após várias tentativas.' })
    .eq('status', 'enviando')
    .lt('atualizado_em', corte)
    .is('provider_message_id', null)
    .gte('tentativas', MAX_TENTATIVAS);

  return data?.length ?? 0;
}

// ── 4. Drenar a fila ─────────────────────────────────────────────────────────────

interface CampanhaDaFila {
  nome: string;
  mensagem: string;
  tipo: TipoMensagem;
  midia_url: string | null;
  mencionar_todos: boolean;
  enquete_opcoes: string[] | null;
  enquete_multipla: boolean | null;
  template_nome: string | null;
  template_idioma: string | null;
  template_cabecalho_url: string | null;
}

interface FilaItem {
  id: string;
  campaign_id: string;
  destino: string;
  destino_nome: string | null;
  tentativas: number;
  campaigns: CampanhaDaFila | null;
}

const CAMPOS_DA_CAMPANHA =
  'nome,mensagem,tipo,midia_url,mencionar_todos,enquete_opcoes,enquete_multipla,' +
  'template_nome,template_idioma,template_cabecalho_url';

/** Quanto ainda cabe hoje neste número. `limite_diario = 0` significa sem teto. */
async function saldoDoDia(
  supabase: SupabaseClient,
  conexao: Connection,
  resultado: ResultadoWhatsApp,
): Promise<number> {
  if (!conexao.limite_diario || conexao.limite_diario <= 0) return Number.POSITIVE_INFINITY;
  const { count } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', conexao.id)
    .gte('enviado_em', inicioDoDiaSP(new Date()));
  const saldo = Math.max(0, conexao.limite_diario - (count ?? 0));
  if (saldo === 0) {
    resultado.avisos.push(
      `[${conexao.nome}] limite diário de ${conexao.limite_diario} mensagens atingido.`,
    );
  }
  return saldo;
}

/** Marca a conexão como quebrada e para de insistir nela neste tick. */
async function derrubarConexao(
  supabase: SupabaseClient,
  conexaoId: string,
  motivo: string,
): Promise<void> {
  await supabase
    .from('connections')
    .update({ status: 'erro', ultimo_erro: motivo.slice(0, 500) })
    .eq('id', conexaoId);
}

// ── 4a. Evolution: uma mensagem por vez, com intervalo ───────────────────────────

/**
 * Esvazia a fila de UM CHIP, respeitando o ritmo dele. Este é o caminho dos GRUPOS.
 *
 * O intervalo entre mensagens não é preciosismo: é o que separa um número que dura de
 * um número restrito em 24 h. Ele é estado persistido (`connections.proximo_envio_em`)
 * porque cada tick é um processo novo e não lembra do anterior.
 */
async function drenarEvolution(
  supabase: SupabaseClient,
  conexao: Connection,
  orcamento: Orcamento,
  resultado: ResultadoWhatsApp,
): Promise<void> {
  if (!conexao.instance_name) return;

  let saldo = await saldoDoDia(supabase, conexao, resultado);
  if (saldo === 0) return;

  let proximoLiberado = conexao.proximo_envio_em;

  while (orcamento.cabe(CUSTO_ENVIO_MS) && saldo > 0) {
    const agora = new Date();

    if (!liberadaEm(proximoLiberado, agora)) {
      const esperaMs = new Date(proximoLiberado as string).getTime() - agora.getTime();
      if (!orcamento.cabe(esperaMs + CUSTO_ENVIO_MS)) return;
      await dormir(esperaMs);
      continue;
    }

    const { data: proximos, error } = await supabase
      .from('campaign_recipients')
      .select(
        `id,campaign_id,destino,destino_nome,tentativas,campaigns!inner(${CAMPOS_DA_CAMPANHA},status)`,
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
    const item = (proximos?.[0] ?? null) as unknown as FilaItem | null;
    if (!item || !item.campaigns) return; // fila vazia para esta conexão

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
        enquete:
          campanha.tipo === 'enquete'
            ? { opcoes: campanha.enquete_opcoes ?? [], multipla: Boolean(campanha.enquete_multipla) }
            : undefined,
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
      const desistir = erro.permanente || item.tentativas + 1 >= MAX_TENTATIVAS;
      await supabase
        .from('campaign_recipients')
        .update({ status: desistir ? 'falha' : 'pendente', erro: erro.message.slice(0, 500) })
        .eq('id', item.id);
      if (desistir) resultado.falhas += 1;
      resultado.avisos.push(`[${conexao.nome}] ${item.destino_nome ?? item.destino}: ${erro.message}`);

      if (erro.status === 404 || erro.status === 401 || erro.status === 403) {
        await derrubarConexao(supabase, conexao.id, erro.message);
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

// ── 4b. API oficial: lotes em paralelo ───────────────────────────────────────────

interface DesfechoEnvio {
  id: string;
  status: 'enviado' | 'pendente' | 'falha';
  provider_message_id: string | null;
  erro: string | null;
  codigo_erro: string | null;
}

interface ItemDoLote {
  id: string;
  campaign_id: string;
  destino: string;
  destino_nome: string | null;
  tentativas: number;
  variaveis: Record<string, string> | null;
}

/**
 * Esvazia a fila de um NÚMERO OFICIAL, em lotes paralelos. Este é o caminho do
 * disparo em massa.
 *
 * Três diferenças em relação ao chip, e as três são o motivo de esta função existir:
 *
 *   • não há intervalo anti-bloqueio. A Meta não pune volume — pune conteúdo ruim, e
 *     o template aprovado é o filtro disso. O que limita aqui é o tier do número;
 *   • a reivindicação é um LOTE atômico (`for update skip locked`), não uma corrida por
 *     linha: com dezenas de mensagens por segundo, duas idas ao banco por mensagem
 *     seriam o gargalo, não a Meta;
 *   • quando a Meta diz "vá mais devagar" (130429) ou "suspeito de spam" (131048), o
 *     motor OBEDECE. Insistir num 131048 é o caminho mais rápido para perder o número.
 */
async function drenarCloud(
  supabase: SupabaseClient,
  conexao: Connection,
  orcamento: Orcamento,
  resultado: ResultadoWhatsApp,
  loteMaximo: number,
): Promise<void> {
  if (!conexao.phone_number_id) {
    resultado.avisos.push(`[${conexao.nome}] conexão oficial sem phone_number_id cadastrado.`);
    return;
  }
  const phoneNumberId = conexao.phone_number_id;

  let saldo = await saldoDoDia(supabase, conexao, resultado);
  if (saldo === 0) return;

  const porSegundo = Math.max(1, Math.min(conexao.msgs_por_segundo ?? 10, 80));
  const campanhas = new Map<string, CampanhaDaFila | null>();
  const cabecalhos = new Map<string, TipoCabecalho | null>();

  while (orcamento.cabe(CUSTO_LOTE_MS) && saldo > 0) {
    const tamanho = Math.max(
      1,
      Math.min(porSegundo, loteMaximo, Number.isFinite(saldo) ? saldo : porSegundo),
    );

    const { data: lote, error } = await supabase.rpc('reivindicar_lote_whatsapp', {
      p_conexao: conexao.id,
      p_limite: tamanho,
    });
    if (error) {
      resultado.avisos.push(`[${conexao.nome}] erro ao reivindicar o lote: ${error.message}`);
      return;
    }
    const itens = (lote ?? []) as ItemDoLote[];
    if (!itens.length) return; // fila vazia para este número

    const inicioDoLote = Date.now();
    const desfechos: DesfechoEnvio[] = [];
    let pausaPedida = 0;
    let conexaoCaiu: string | null = null;

    await Promise.all(
      itens.map(async (item) => {
        const campanha = await lerCampanhaDaFila(supabase, campanhas, item.campaign_id);
        if (!campanha?.template_nome) {
          desfechos.push({
            id: item.id,
            status: 'falha',
            provider_message_id: null,
            erro: 'Campanha sem template — disparo em massa exige template aprovado.',
            codigo_erro: null,
          });
          return;
        }

        const tipoCabecalho = await lerTipoDeCabecalho(supabase, cabecalhos, conexao.id, campanha);

        try {
          const envio = await enviarTemplate(phoneNumberId, {
            para: item.destino,
            template: campanha.template_nome,
            idioma: campanha.template_idioma ?? 'pt_BR',
            variaveisCorpo: valoresEmOrdem(item.variaveis),
            tipoCabecalho,
            midiaCabecalhoUrl: campanha.template_cabecalho_url,
          });
          desfechos.push({
            id: item.id,
            status: 'enviado',
            provider_message_id: envio.messageId,
            erro: null,
            codigo_erro: null,
          });
        } catch (e) {
          const erro = e instanceof CloudError ? e : new CloudError(String(e));
          const desistir = erro.permanente || item.tentativas >= MAX_TENTATIVAS;
          desfechos.push({
            id: item.id,
            // Quem não desiste volta para 'pendente' e o próximo tick tenta de novo.
            status: desistir ? 'falha' : 'pendente',
            provider_message_id: null,
            erro: erro.message.slice(0, 500),
            codigo_erro: erro.codigo,
          });
          if (erro.esperarMs > pausaPedida) pausaPedida = erro.esperarMs;
          if (erro.derrubaConexao) conexaoCaiu = erro.message;
        }
      }),
    );

    const { error: regErr } = await supabase.rpc('registrar_envios_whatsapp', {
      p_resultados: desfechos,
    });
    if (regErr) {
      // As linhas ficam em 'enviando' e a recuperação de órfãs as devolve em 15 min.
      // Perder o registro é ruim; reenviar tudo por não conseguir registrar é pior.
      resultado.avisos.push(`[${conexao.nome}] erro ao registrar o lote: ${regErr.message}`);
      return;
    }

    const enviados = desfechos.filter((d) => d.status === 'enviado').length;
    resultado.enviadas += enviados;
    resultado.falhas += desfechos.filter((d) => d.status === 'falha').length;
    if (Number.isFinite(saldo)) saldo -= enviados;

    if (conexaoCaiu) {
      await derrubarConexao(supabase, conexao.id, conexaoCaiu);
      resultado.avisos.push(`[${conexao.nome}] ${conexaoCaiu}`);
      return;
    }

    // A Meta pediu para esperar. Se não couber no orçamento, o tick acaba aqui e o
    // próximo retoma — a fila é o estado, e ninguém perde nada esperando.
    if (pausaPedida > 0) {
      resultado.avisos.push(
        `[${conexao.nome}] a Meta pediu ${Math.round(pausaPedida / 1000)}s de pausa — o motor obedeceu.`,
      );
      if (!orcamento.cabe(pausaPedida + CUSTO_LOTE_MS)) return;
      await dormir(pausaPedida);
      continue;
    }

    // Respiro até fechar 1 segundo desde o início do lote. É isto que materializa o
    // `msgs_por_segundo`: um lote de 10 que levou 300 ms dorme os outros 700 ms.
    const decorrido = Date.now() - inicioDoLote;
    if (decorrido < 1_000) await dormir(1_000 - decorrido);
  }
}

/** Mapa posição → texto de volta ao array ordenado que a Cloud API espera. */
function valoresEmOrdem(variaveis: Record<string, string> | null): string[] {
  if (!variaveis) return [];
  const posicoes = Object.keys(variaveis)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1);
  if (!posicoes.length) return [];
  const total = Math.max(...posicoes);
  return Array.from({ length: total }, (_, i) => variaveis[String(i + 1)] ?? '');
}

/** Lê a campanha uma vez por tick e guarda: um lote de 10 é uma leitura, não dez. */
async function lerCampanhaDaFila(
  supabase: SupabaseClient,
  cache: Map<string, CampanhaDaFila | null>,
  campaignId: string,
): Promise<CampanhaDaFila | null> {
  if (cache.has(campaignId)) return cache.get(campaignId) ?? null;
  const { data } = await supabase
    .from('campaigns')
    .select(CAMPOS_DA_CAMPANHA)
    .eq('id', campaignId)
    .maybeSingle();
  const campanha = (data as unknown as CampanhaDaFila | null) ?? null;
  cache.set(campaignId, campanha);
  return campanha;
}

/** O template desta campanha tem cabeçalho? De que tipo? Também guardado por tick. */
async function lerTipoDeCabecalho(
  supabase: SupabaseClient,
  cache: Map<string, TipoCabecalho | null>,
  conexaoId: string,
  campanha: CampanhaDaFila,
): Promise<TipoCabecalho | null> {
  const chave = `${campanha.template_nome}|${campanha.template_idioma ?? 'pt_BR'}`;
  if (cache.has(chave)) return cache.get(chave) ?? null;
  const { data } = await supabase
    .from('whatsapp_templates')
    .select('cabecalho_tipo')
    .eq('connection_id', conexaoId)
    .eq('nome', campanha.template_nome as string)
    .eq('idioma', campanha.template_idioma ?? 'pt_BR')
    .maybeSingle();
  const tipo = (data?.cabecalho_tipo as TipoCabecalho | null) ?? null;
  cache.set(chave, tipo);
  return tipo;
}

// ── 5. Fechar o que terminou ─────────────────────────────────────────────────────

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

/**
 * Campanha 'enviando' sem nada pendente está encerrada. O status final distingue os
 * dois desfechos: se NENHUMA mensagem saiu, isso é erro (e a tela precisa gritar);
 * se algumas falharam mas a maioria saiu, é uma campanha enviada com falhas.
 */
export async function fecharCampanhas(
  supabase: SupabaseClient,
  agora: Date,
  avisos: string[],
): Promise<number> {
  const { data: emVoo } = await supabase
    .from('campaigns')
    .select('id,nome,atualizado_em')
    .eq('status', 'enviando')
    // Fila ainda sendo montada não pode ser fechada: os próximos 49 mil destinatários
    // ainda não existem, e "0 pendentes" agora significaria "acabou" por engano.
    .eq('fanout_completo', true)
    .limit(100);
  if (!emVoo?.length) return 0;

  let fechadas = 0;
  for (const c of emVoo as { id: string; nome: string; atualizado_em: string }[]) {
    const pendentes = await contarFila(supabase, c.id, ['pendente', 'enviando']);
    if (pendentes > 0) continue;

    const total = await contarFila(supabase, c.id);

    // Campanha 'enviando' e SEM nenhum destinatário pode ser uma de duas coisas:
    // um fan-out que falhou, ou um fan-out que está acontecendo AGORA, neste
    // milissegundo, em outro tick — a promoção grava o status antes de inserir a fila.
    // Cinco minutos de carência resolve: fan-out real termina em segundos.
    if (total === 0) {
      const idadeMin = (agora.getTime() - new Date(c.atualizado_em).getTime()) / 60_000;
      if (!Number.isFinite(idadeMin) || idadeMin < 5) continue;
    }

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
    enfileiradas: 0,
    avisos: [],
  };

  const config = await lerConfigEnvio(supabase);

  resultado.promovidas = await promoverCampanhas(supabase, agora, resultado.avisos);
  resultado.enfileiradas = await continuarFanout(supabase, orcamento, resultado.avisos);
  await recuperarOrfas(supabase, agora);

  // A janela de horário vale para o ENVIO, não para a montagem: a fila pode crescer às
  // 3 h da manhã sem incomodar ninguém; o que não pode é a mensagem chegar.
  const podeEnviar =
    !config.respeitar_janela || dentroDaJanela(agora, config.janela_inicio, config.janela_fim);

  if (podeEnviar) {
    const { data: conexoes } = await supabase
      .from('connections')
      .select('*')
      .eq('ativo', true)
      .eq('status', 'conectada')
      .order('criado_em', { ascending: true });

    // Conexões em paralelo: dois números disparam ao mesmo tempo, cada um no seu ritmo
    // e pelo seu conector. O paralelismo é entre NÚMEROS; dentro de um chip da Evolution
    // continua sendo uma mensagem por vez, que é o que protege contra bloqueio.
    await Promise.all(
      ((conexoes ?? []) as Connection[]).map((c) =>
        (c.provider === 'cloud'
          ? drenarCloud(supabase, c, orcamento, resultado, config.lote_whatsapp)
          : drenarEvolution(supabase, c, orcamento, resultado)
        ).catch((e) => {
          resultado.avisos.push(`[${c.nome}] falhou: ${e instanceof Error ? e.message : String(e)}`);
        }),
      ),
    );
  } else {
    resultado.avisos.push(
      `Fora da janela de envio (${config.janela_inicio}–${config.janela_fim}). A fila espera.`,
    );
  }

  resultado.fechadas = await fecharCampanhas(supabase, agora, resultado.avisos);

  const { count } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pendente', 'enviando']);
  resultado.pendentes = count ?? 0;

  return resultado;
}
