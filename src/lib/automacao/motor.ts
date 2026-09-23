// O motor das automações — quem ANDA pelo fluxo.
//
// Três portas de entrada, um caminho só:
//
//   • receberMensagem  ← webhook da Meta: a pessoa escreveu ou clicou
//   • rodarAutomacoes  ← tick de minuto em minuto: acabou um "aguarde", venceu um prazo
//   • iniciarFluxo     ← tela (testar, iniciar pela caixa de conversa) e webhook externo
//
// Todas terminam em `avancar`, que percorre o grafo nó a nó até precisar ESPERAR
// (resposta ou tempo) ou acabar. Quando espera, o estado vai para a linha da execução
// e o processo termina — ninguém fica parado segurando memória por dois dias. É o que
// deixa isto rodar numa função serverless da Vercel.
//
// Regras que valem para o arquivo inteiro:
//   1. Nunca lança para quem chamou. Erro vira `estado = 'erro'` na execução, com a
//      frase, e um evento no nó — a tela mostra onde quebrou.
//   2. A janela de 24 h é conferida ANTES de mandar texto livre. Fora dela, a Meta
//      recusa (131047); o fluxo segue pela saída "janela fechada", se houver.
//   3. Nada roda para quem pediu para sair nem com a automação pausada pelo atendente.

import type { SupabaseClient } from '@supabase/supabase-js';
import { enviarCorpo, enviarTemplate, marcarLida, CloudError } from '../whatsapp/cloud';
import { normalizarTelefoneBR } from '../whatsapp/jid';
import { enviarEmail } from '../email/provider';
import type { Connection } from '../types';
import {
  avaliarCondicao,
  calcularAcordar,
  casaPalavraChave,
  codigoDeReferencia,
  escolherVariante,
  lerEntrada,
  lerIdDeResposta,
  montarMensagens,
  montarPergunta,
  personalizar,
  prefixoDeResposta,
  previaDoCorpo,
  tipoDoCorpo,
  validarResposta,
  type CorpoMeta,
  type Entrada,
  type MensagemRecebida,
  type Pessoa,
} from './montar';
import {
  janelaAberta,
  saidasDoNo,
  type Acao,
  type Fluxo,
  type Gatilho,
  type Grafo,
  type No,
} from './tipos';

type Db = SupabaseClient;

/** Teto de nós por rodada: um laço sem "aguarde" não pode prender a função. */
const MAX_PASSOS_RODADA = 40;
/** Teto de nós na vida da execução. */
const MAX_PASSOS_TOTAL = 400;
/** Profundidade de "ir para outro fluxo" / "tag adicionada" encadeados. */
const MAX_PROFUNDIDADE = 4;

// ── Carregamentos ────────────────────────────────────────────────────────────────

interface ContatoLinha {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  tags: string[] | null;
  campos: Record<string, unknown> | null;
  status_whatsapp: string;
}

interface ConversaLinha {
  id: string;
  connection_id: string;
  contact_id: string | null;
  wa_id: string;
  nome_perfil: string | null;
  ultima_entrada_em: string | null;
  automacao_pausada_ate: string | null;
  resposta_padrao_em: string | null;
  nao_lidas: number;
  criado_em: string;
}

interface ExecucaoLinha {
  id: string;
  fluxo_id: string;
  conversa_id: string;
  contact_id: string | null;
  no_atual: string | null;
  estado: string;
  acordar_em: string | null;
  aguardando: Record<string, unknown> | null;
  passos: number;
}

/** Tudo que uma rodada precisa, carregado uma vez. */
interface Contexto {
  db: Db;
  conexao: Connection;
  conversa: ConversaLinha;
  contato: ContatoLinha | null;
  /** O wamid da última mensagem da pessoa — para o "digitando…". */
  ultimaEntradaWamid: string | null;
  profundidade: number;
  fluxos: Map<string, Fluxo>;
}

async function carregarFluxo(ctx: Contexto, id: string): Promise<Fluxo | null> {
  if (ctx.fluxos.has(id)) return ctx.fluxos.get(id)!;
  const { data } = await ctx.db.from('fluxos').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  const f = data as Fluxo;
  f.grafo = normalizarGrafo(f.grafo);
  ctx.fluxos.set(id, f);
  return f;
}

function normalizarGrafo(g: unknown): Grafo {
  const x = (g ?? {}) as Partial<Grafo>;
  return { nos: Array.isArray(x.nos) ? x.nos : [], ligacoes: Array.isArray(x.ligacoes) ? x.ligacoes : [] };
}

async function recarregarContato(ctx: Contexto): Promise<void> {
  if (!ctx.conversa.contact_id) return;
  const { data } = await ctx.db
    .from('contacts')
    .select('id,nome,email,telefone,tags,campos,status_whatsapp')
    .eq('id', ctx.conversa.contact_id)
    .maybeSingle();
  ctx.contato = (data as ContatoLinha | null) ?? null;
}

function pessoaDe(ctx: Contexto): Pessoa {
  const c = ctx.contato;
  return {
    nome: c?.nome ?? ctx.conversa.nome_perfil,
    email: c?.email ?? null,
    telefone: c?.telefone ?? ctx.conversa.wa_id,
    tags: c?.tags ?? [],
    campos: c?.campos ?? {},
  };
}

function descadastrado(ctx: Contexto): boolean {
  return ctx.contato?.status_whatsapp === 'descadastrado';
}

function pausada(ctx: Contexto, agora = Date.now()): boolean {
  const ate = ctx.conversa.automacao_pausada_ate;
  return Boolean(ate && new Date(ate).getTime() > agora);
}

// ── Registro ─────────────────────────────────────────────────────────────────────

async function evento(
  ctx: Contexto,
  fluxoId: string,
  execucaoId: string | null,
  noId: string,
  tipo: 'entrou' | 'enviou' | 'saida' | 'erro',
  saida?: string | null,
  detalhe?: string | null,
): Promise<void> {
  await ctx.db
    .from('fluxo_eventos')
    .insert({ fluxo_id: fluxoId, execucao_id: execucaoId, no_id: noId, tipo, saida: saida ?? null, detalhe: detalhe?.slice(0, 500) ?? null })
    .then(
      () => undefined,
      () => undefined,
    );
}

async function atualizarExecucao(ctx: Contexto, id: string, patch: Record<string, unknown>): Promise<void> {
  await ctx.db
    .from('fluxo_execucoes')
    .update({ ...patch, atualizada_em: new Date().toISOString() })
    .eq('id', id);
}

async function concluir(ctx: Contexto, exec: ExecucaoLinha, estado: 'concluida' | 'erro' | 'cancelada', erro?: string) {
  await atualizarExecucao(ctx, exec.id, {
    estado,
    acordar_em: null,
    aguardando: null,
    travada_ate: null,
    erro: erro ?? null,
    concluida_em: new Date().toISOString(),
  });
  if (estado === 'concluida') {
    const f = ctx.fluxos.get(exec.fluxo_id);
    if (f) {
      await ctx.db
        .from('fluxos')
        .update({ concluidas_total: (f.concluidas_total ?? 0) + 1 })
        .eq('id', f.id)
        .then(
          () => undefined,
          () => undefined,
        );
      f.concluidas_total = (f.concluidas_total ?? 0) + 1;
    }
  }
}

/** Manda um corpo e guarda na conversa. Devolve o erro (já em português) ou null. */
async function mandar(
  ctx: Contexto,
  corpo: CorpoMeta,
  origem: { fluxoId?: string | null; noId?: string | null; tipo?: 'fluxo' | 'manual' | 'teste' },
): Promise<string | null> {
  const phone = ctx.conexao.phone_number_id;
  if (!phone) return 'Conexão sem número da Meta.';
  let wamid: string | null = null;
  let erro: string | null = null;
  try {
    const r = await enviarCorpo(phone, ctx.conversa.wa_id, corpo);
    wamid = r.messageId;
  } catch (e) {
    erro = e instanceof CloudError ? e.message : String(e);
  }
  const agora = new Date().toISOString();
  await ctx.db.from('wa_mensagens').insert({
    conversa_id: ctx.conversa.id,
    direcao: 'out',
    tipo: tipoDoCorpo(corpo),
    texto: previaDoCorpo(corpo).slice(0, 4000),
    payload: corpo,
    wamid,
    status: erro ? 'falha' : 'enviado',
    erro,
    origem: origem.tipo ?? 'fluxo',
    fluxo_id: origem.fluxoId ?? null,
    no_id: origem.noId ?? null,
  });
  await ctx.db
    .from('wa_conversas')
    .update({ ultima_mensagem_em: agora, ultima_previa: previaDoCorpo(corpo).slice(0, 200) })
    .eq('id', ctx.conversa.id);
  return erro;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Ações ────────────────────────────────────────────────────────────────────────

async function executarAcao(ctx: Contexto, a: Acao, fluxo: Fluxo, exec: ExecucaoLinha): Promise<string | null> {
  const contato = ctx.contato;
  const agora = new Date().toISOString();
  switch (a.tipo) {
    case 'adicionar_tag':
    case 'remover_tag': {
      if (!contato) return 'sem contato';
      const tag = personalizar(a.tag, pessoaDe(ctx)).trim();
      if (!tag) return null;
      const atuais = contato.tags ?? [];
      const tem = atuais.some((t) => t.toLowerCase() === tag.toLowerCase());
      if (a.tipo === 'adicionar_tag' && tem) return null;
      if (a.tipo === 'remover_tag' && !tem) return null;
      const novas = a.tipo === 'adicionar_tag' ? [...atuais, tag] : atuais.filter((t) => t.toLowerCase() !== tag.toLowerCase());
      await ctx.db.from('contacts').update({ tags: novas }).eq('id', contato.id);
      contato.tags = novas;
      if (a.tipo === 'adicionar_tag') await dispararPorTag(ctx, tag);
      return null;
    }
    case 'definir_campo':
    case 'limpar_campo': {
      if (!contato) return 'sem contato';
      const valor = a.tipo === 'definir_campo' ? personalizar(a.valor, pessoaDe(ctx)) : null;
      // nome/email/telefone são colunas; o resto mora em `campos`.
      if (a.chave === 'nome' || a.chave === 'email') {
        await ctx.db.from('contacts').update({ [a.chave]: valor || null }).eq('id', contato.id);
        (contato as unknown as Record<string, unknown>)[a.chave] = valor || null;
        return null;
      }
      const campos = { ...(contato.campos ?? {}) };
      if (valor === null || valor === '') delete campos[a.chave];
      else campos[a.chave] = valor;
      await ctx.db.from('contacts').update({ campos }).eq('id', contato.id);
      contato.campos = campos;
      return null;
    }
    case 'adicionar_lista':
      if (!contato) return 'sem contato';
      await ctx.db
        .from('list_members')
        .upsert({ list_id: a.listaId, contact_id: contato.id }, { onConflict: 'list_id,contact_id', ignoreDuplicates: true });
      return null;
    case 'remover_lista':
      if (!contato) return 'sem contato';
      await ctx.db.from('list_members').delete().eq('list_id', a.listaId).eq('contact_id', contato.id);
      return null;
    case 'descadastrar':
      if (!contato) return 'sem contato';
      await ctx.db.from('contacts').update({ status_whatsapp: 'descadastrado', optout_whatsapp_em: agora }).eq('id', contato.id);
      contato.status_whatsapp = 'descadastrado';
      return null;
    case 'reinscrever':
      if (!contato) return 'sem contato';
      await ctx.db.from('contacts').update({ status_whatsapp: 'ativo', optout_whatsapp_em: null }).eq('id', contato.id);
      contato.status_whatsapp = 'ativo';
      return null;
    case 'pausar_automacao': {
      const ate = new Date(Date.now() + Math.max(1, a.horas || 24) * 3_600_000).toISOString();
      await ctx.db.from('wa_conversas').update({ automacao_pausada_ate: ate }).eq('id', ctx.conversa.id);
      ctx.conversa.automacao_pausada_ate = ate;
      return null;
    }
    case 'parar_outros_fluxos':
      await ctx.db
        .from('fluxo_execucoes')
        .update({ estado: 'cancelada', acordar_em: null, concluida_em: agora, erro: 'Parado por outro fluxo.' })
        .eq('conversa_id', ctx.conversa.id)
        .neq('id', exec.id)
        .in('estado', ['rodando', 'aguardando_resposta', 'aguardando_tempo']);
      return null;
    case 'notificar_equipe': {
      const { data: rem } = await ctx.db.from('app_settings').select('valor').eq('chave', 'email_remetente').maybeSingle();
      const remetente = (rem?.valor ?? {}) as { nome?: string; email?: string };
      if (!remetente.email) return 'sem remetente de e-mail configurado';
      const p = pessoaDe(ctx);
      const texto = `${personalizar(a.mensagem || 'Novo contato pediu atenção.', p)}\n\nContato: ${p.nome ?? '-'} · +${ctx.conversa.wa_id}\nFluxo: ${fluxo.nome}`;
      try {
        await enviarEmail({
          para: a.email,
          de: remetente.email,
          deNome: remetente.nome || 'SendFlow',
          assunto: `SendFlow · ${p.nome ?? ctx.conversa.wa_id} precisa de atenção`,
          html: texto
            .split('\n')
            .map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
            .join(''),
          texto,
        });
      } catch (e) {
        return `e-mail não saiu: ${e instanceof Error ? e.message : e}`;
      }
      return null;
    }
    case 'webhook': {
      const p = pessoaDe(ctx);
      try {
        const res = await fetch(a.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            evento: 'sendflow.fluxo',
            fluxo: { id: fluxo.id, nome: fluxo.nome },
            contato: { id: contato?.id ?? null, nome: p.nome, telefone: ctx.conversa.wa_id, email: p.email, tags: p.tags, campos: p.campos },
            quando: agora,
          }),
          signal: AbortSignal.timeout(8000),
        });
        return res.ok ? null : `webhook respondeu ${res.status}`;
      } catch {
        return 'webhook não respondeu';
      }
    }
  }
}

/** "Tag adicionada" como gatilho: outra automação pode começar por causa desta tag. */
async function dispararPorTag(ctx: Contexto, tag: string): Promise<void> {
  if (ctx.profundidade >= MAX_PROFUNDIDADE) return;
  const gatilhos = await gatilhosAtivos(ctx, ['tag_adicionada']);
  for (const g of gatilhos) {
    if (String(g.config.tag ?? '').trim().toLowerCase() !== tag.toLowerCase()) continue;
    await iniciarNoContexto({ ...ctx, profundidade: ctx.profundidade + 1 }, g.fluxo_id, g.id);
  }
}

// ── Andar pelo grafo ─────────────────────────────────────────────────────────────

function proximoNo(fluxo: Fluxo, noId: string, saida: string): string | null {
  return fluxo.grafo.ligacoes.find((l) => l.de === noId && l.saida === saida)?.para ?? null;
}

function saidaLigada(fluxo: Fluxo, noId: string, saida: string): boolean {
  return proximoNo(fluxo, noId, saida) !== null;
}

/**
 * Anda a partir de `noId`. Para quando o fluxo acaba, quando precisa esperar ou quando
 * bate no teto de passos da rodada (aí agenda continuar no próximo tick).
 */
async function avancar(ctx: Contexto, exec: ExecucaoLinha, noId: string | null): Promise<void> {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  if (!fluxo) return concluir(ctx, exec, 'erro', 'O fluxo foi apagado.');

  let atual = noId;
  for (let passo = 0; passo < MAX_PASSOS_RODADA; passo += 1) {
    if (!atual) return concluir(ctx, exec, 'concluida');
    if (exec.passos >= MAX_PASSOS_TOTAL) {
      return concluir(ctx, exec, 'erro', 'O fluxo passou de 400 passos — provável laço sem fim.');
    }
    if (descadastrado(ctx)) return concluir(ctx, exec, 'cancelada', 'O contato pediu para sair.');
    if (pausada(ctx)) return concluir(ctx, exec, 'cancelada', 'Automação pausada para atendimento humano.');

    const no = fluxo.grafo.nos.find((n) => n.id === atual);
    if (!no) return concluir(ctx, exec, 'concluida');
    exec.passos += 1;
    exec.no_atual = no.id;
    await evento(ctx, fluxo.id, exec.id, no.id, 'entrou');

    const r = await executarNo(ctx, fluxo, exec, no);
    if (r.tipo === 'encerrada') return;
    if (r.tipo === 'esperar') {
      await atualizarExecucao(ctx, exec.id, {
        no_atual: no.id,
        estado: r.estado,
        acordar_em: r.acordarEm,
        aguardando: r.aguardando,
        passos: exec.passos,
        travada_ate: null,
      });
      return;
    }
    if (r.tipo === 'fim') {
      await atualizarExecucao(ctx, exec.id, { passos: exec.passos, no_atual: no.id });
      return concluir(ctx, exec, r.erro ? 'erro' : 'concluida', r.erro);
    }
    await evento(ctx, fluxo.id, exec.id, no.id, 'saida', r.saida);
    atual = proximoNo(fluxo, no.id, r.saida);
  }

  // Teto da rodada: segue no próximo tick, sem perder o lugar.
  await atualizarExecucao(ctx, exec.id, {
    no_atual: atual,
    estado: 'aguardando_tempo',
    acordar_em: new Date().toISOString(),
    aguardando: { tipo: 'continuar' },
    passos: exec.passos,
    travada_ate: null,
  });
}

type ResultadoNo =
  | { tipo: 'seguir'; saida: string }
  | {
      tipo: 'esperar';
      estado: 'aguardando_resposta' | 'aguardando_tempo';
      acordarEm: string | null;
      aguardando: Record<string, unknown>;
    }
  | { tipo: 'fim'; erro?: string }
  /** O próprio nó já encerrou a execução (ex.: "ir para outro fluxo"). */
  | { tipo: 'encerrada' };

async function executarNo(ctx: Contexto, fluxo: Fluxo, exec: ExecucaoLinha, no: No): Promise<ResultadoNo> {
  const aberta = janelaAberta(ctx.conversa.ultima_entrada_em);
  const origem = { fluxoId: fluxo.id, noId: no.id };

  switch (no.tipo) {
    case 'inicio':
      return { tipo: 'seguir', saida: 'proximo' };

    case 'mensagem': {
      const d = no.dados;
      if (!aberta) {
        await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, 'janela de 24 h fechada');
        if (saidaLigada(fluxo, no.id, 'janela_fechada')) return { tipo: 'seguir', saida: 'janela_fechada' };
        return { tipo: 'fim', erro: 'Janela de 24 h fechada: só template pode sair. Use um bloco Template antes.' };
      }
      const corpos = montarMensagens(d, pessoaDe(ctx), prefixoDeResposta(fluxo.id, no.id));
      for (let i = 0; i < corpos.length; i += 1) {
        if (d.digitando && ctx.ultimaEntradaWamid && ctx.conexao.phone_number_id) {
          await marcarLida(ctx.conexao.phone_number_id, ctx.ultimaEntradaWamid, { digitando: true });
          await esperar(i === 0 ? 700 : 1200);
        }
        const erro = await mandar(ctx, corpos[i], origem);
        if (erro) {
          await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, erro);
          return { tipo: 'fim', erro };
        }
      }
      await evento(ctx, fluxo.id, exec.id, no.id, 'enviou');
      if (d.interacao.tipo === 'botoes' || d.interacao.tipo === 'lista') {
        const min = Number(d.esperarMinutos ?? 0);
        return {
          tipo: 'esperar',
          estado: 'aguardando_resposta',
          acordarEm: min > 0 ? new Date(Date.now() + min * 60_000).toISOString() : null,
          aguardando: { tipo: 'botoes' },
        };
      }
      return { tipo: 'seguir', saida: 'proximo' };
    }

    case 'template': {
      const d = no.dados;
      const phone = ctx.conexao.phone_number_id;
      if (!phone) return { tipo: 'fim', erro: 'Conexão sem número da Meta.' };
      const { data: tpl } = await ctx.db
        .from('whatsapp_templates')
        .select('corpo,cabecalho_tipo,variaveis_corpo,variaveis_cabecalho,botoes,status')
        .eq('connection_id', ctx.conexao.id)
        .eq('nome', d.nome)
        .eq('idioma', d.idioma)
        .maybeSingle();
      const p = pessoaDe(ctx);
      const nCorpo = Number(tpl?.variaveis_corpo ?? 0);
      const variaveis = Array.from({ length: nCorpo }, (_, i) => personalizar(d.variaveis[String(i + 1)] ?? '', p) || '-');
      let wamid: string | null = null;
      let erro: string | null = null;
      try {
        const r = await enviarTemplate(phone, {
          para: ctx.conversa.wa_id,
          template: d.nome,
          idioma: d.idioma,
          variaveisCorpo: variaveis,
          tipoCabecalho: (tpl?.cabecalho_tipo as 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null) ?? null,
          midiaCabecalhoUrl: d.cabecalhoUrl ?? null,
          // O payload de cada botão de resposta rápida leva o endereço da seta. O índice
          // é a posição do botão NO TEMPLATE (que pode ter botões de link no meio).
          botoesPayload: (d.botoes ?? [])
            .map((texto, i) => {
              const lista = (Array.isArray(tpl?.botoes) ? tpl.botoes : []) as { type?: string; text?: string }[];
              const indice = lista.findIndex((b) => String(b.type).toUpperCase() === 'QUICK_REPLY' && b.text === texto);
              return { indice, payload: `${prefixoDeResposta(fluxo.id, no.id)}botao_${i}` };
            })
            .filter((b) => b.indice >= 0),
        });
        wamid = r.messageId;
      } catch (e) {
        erro = e instanceof CloudError ? e.message : String(e);
      }
      const corpoTexto = String(tpl?.corpo ?? '').replace(/\{\{(\d+)\}\}/g, (_, n) => variaveis[Number(n) - 1] ?? '');
      await ctx.db.from('wa_mensagens').insert({
        conversa_id: ctx.conversa.id,
        direcao: 'out',
        tipo: 'template',
        texto: corpoTexto || `[template ${d.nome}]`,
        payload: { template: d.nome, idioma: d.idioma, variaveis, botoes: d.botoes ?? [] },
        wamid,
        status: erro ? 'falha' : 'enviado',
        erro,
        origem: 'fluxo',
        fluxo_id: fluxo.id,
        no_id: no.id,
      });
      await ctx.db
        .from('wa_conversas')
        .update({ ultima_mensagem_em: new Date().toISOString(), ultima_previa: (corpoTexto || d.nome).slice(0, 200) })
        .eq('id', ctx.conversa.id);
      if (erro) {
        await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, erro);
        return saidaLigada(fluxo, no.id, 'falha') ? { tipo: 'seguir', saida: 'falha' } : { tipo: 'fim', erro };
      }
      await evento(ctx, fluxo.id, exec.id, no.id, 'enviou');
      // Algum botão do template leva a algum lugar? Então espera o clique.
      const botoesLigados = (d.botoes ?? []).some((_, i) => saidaLigada(fluxo, no.id, `botao_${i}`));
      if (botoesLigados) {
        return { tipo: 'esperar', estado: 'aguardando_resposta', acordarEm: null, aguardando: { tipo: 'template' } };
      }
      return { tipo: 'seguir', saida: 'proximo' };
    }

    case 'pergunta': {
      if (!aberta) {
        if (saidaLigada(fluxo, no.id, 'janela_fechada')) return { tipo: 'seguir', saida: 'janela_fechada' };
        return { tipo: 'fim', erro: 'Janela de 24 h fechada: a pergunta não pôde sair.' };
      }
      const erro = await mandar(ctx, montarPergunta(no.dados, pessoaDe(ctx), prefixoDeResposta(fluxo.id, no.id)), origem);
      if (erro) {
        await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, erro);
        return { tipo: 'fim', erro };
      }
      await evento(ctx, fluxo.id, exec.id, no.id, 'enviou');
      const min = Number(no.dados.esperarMinutos ?? 0);
      return {
        tipo: 'esperar',
        estado: 'aguardando_resposta',
        acordarEm: min > 0 ? new Date(Date.now() + min * 60_000).toISOString() : null,
        aguardando: { tipo: 'pergunta', tentativas: 0 },
      };
    }

    case 'aguardar':
      return {
        tipo: 'esperar',
        estado: 'aguardando_tempo',
        acordarEm: calcularAcordar(no.dados, new Date()).toISOString(),
        aguardando: { tipo: 'tempo' },
      };

    case 'condicao': {
      const p = pessoaDe(ctx);
      const ok = avaliarCondicao(no.dados, {
        ...p,
        janelaAberta: aberta,
        inscritoWhatsapp: !descadastrado(ctx),
      });
      return { tipo: 'seguir', saida: ok ? 'sim' : 'nao' };
    }

    case 'acao': {
      for (const a of no.dados.acoes) {
        const erro = await executarAcao(ctx, a, fluxo, exec).catch((e) => String(e));
        if (erro) await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, `${a.tipo}: ${erro}`);
      }
      return { tipo: 'seguir', saida: 'proximo' };
    }

    case 'randomizador': {
      const v = escolherVariante(no.dados.variantes);
      return v ? { tipo: 'seguir', saida: v.id } : { tipo: 'fim' };
    }

    case 'ir_para': {
      const destino = no.dados.fluxoId;
      if (!destino || destino === fluxo.id) return { tipo: 'fim' };
      if (ctx.profundidade >= MAX_PROFUNDIDADE) return { tipo: 'fim', erro: 'Muitos "ir para" encadeados.' };
      await atualizarExecucao(ctx, exec.id, { passos: exec.passos, no_atual: no.id });
      await concluir(ctx, exec, 'concluida');
      await iniciarNoContexto({ ...ctx, profundidade: ctx.profundidade + 1 }, destino, null);
      return { tipo: 'encerrada' };
    }

    case 'fim':
      return { tipo: 'fim' };
  }
}

// ── Retomar quem estava esperando ────────────────────────────────────────────────

/**
 * A pessoa respondeu e havia uma execução esperando por ela. Devolve `true` se a
 * resposta foi CONSUMIDA pelo fluxo — aí nenhum gatilho de palavra-chave roda.
 */
async function retomarComResposta(ctx: Contexto, exec: ExecucaoLinha, entrada: Entrada): Promise<boolean> {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  const no = fluxo?.grafo.nos.find((n) => n.id === exec.no_atual);
  if (!fluxo || !no) {
    await concluir(ctx, exec, 'cancelada', 'O bloco em espera não existe mais.');
    return false;
  }
  const tipoEspera = String(exec.aguardando?.tipo ?? '');

  if (no.tipo === 'pergunta') {
    const valor = validarResposta(no.dados.tipoResposta, entrada.texto);
    if (valor !== null) {
      if (no.dados.salvarEm) await salvarResposta(ctx, no.dados.salvarEm, valor);
      await evento(ctx, fluxo.id, exec.id, no.id, 'saida', 'respondeu');
      await avancar(ctx, exec, proximoNo(fluxo, no.id, 'respondeu'));
      return true;
    }
    const tentativas = Number(exec.aguardando?.tentativas ?? 0) + 1;
    if (tentativas < Math.max(1, no.dados.tentativas ?? 2)) {
      await mandar(ctx, { type: 'text', text: { body: no.dados.mensagemErro || 'Não entendi. Pode mandar de novo?' } }, { fluxoId: fluxo.id, noId: no.id });
      await atualizarExecucao(ctx, exec.id, { aguardando: { tipo: 'pergunta', tentativas } });
      return true;
    }
    await evento(ctx, fluxo.id, exec.id, no.id, 'saida', 'nao_respondeu');
    await avancar(ctx, exec, proximoNo(fluxo, no.id, 'nao_respondeu'));
    return true;
  }

  if (tipoEspera === 'botoes' || tipoEspera === 'template') {
    // Clique vem pelo roteamento de `f:` (antes de chegar aqui). Chegou texto livre.
    if (saidaLigada(fluxo, no.id, 'texto_livre')) {
      await evento(ctx, fluxo.id, exec.id, no.id, 'saida', 'texto_livre');
      await avancar(ctx, exec, proximoNo(fluxo, no.id, 'texto_livre'));
      return true;
    }
    // Sem caminho para texto livre: a espera acaba e a mensagem vai para os gatilhos.
    await concluir(ctx, exec, 'concluida');
    return false;
  }

  await concluir(ctx, exec, 'cancelada');
  return false;
}

async function salvarResposta(ctx: Contexto, chave: string, valor: string): Promise<void> {
  if (!ctx.contato) return;
  if (chave === 'nome' || chave === 'email') {
    await ctx.db.from('contacts').update({ [chave]: valor }).eq('id', ctx.contato.id);
    (ctx.contato as unknown as Record<string, unknown>)[chave] = valor;
    return;
  }
  const campos = { ...(ctx.contato.campos ?? {}), [chave]: valor };
  await ctx.db.from('contacts').update({ campos }).eq('id', ctx.contato.id);
  ctx.contato.campos = campos;
}

/**
 * Um clique num botão de fluxo (`f:<fluxo>:<nó>:<saída>`). Segue a seta daquela saída
 * — reaproveitando a execução que esperava naquele nó, ou abrindo uma nova quando o
 * clique é num botão antigo.
 */
async function rotearClique(ctx: Contexto, alvo: { fluxoId: string; noId: string; saida: string }): Promise<boolean> {
  const fluxo = await carregarFluxo(ctx, alvo.fluxoId);
  if (!fluxo) return false;
  const no = fluxo.grafo.nos.find((n) => n.id === alvo.noId);
  if (!no) return false;
  // A saída ainda existe no nó? (o botão pode ter sido apagado depois do envio)
  const existe = saidasDoNo(no).some((s) => s.id === alvo.saida);
  // Sugestão de PERGUNTA (`_s0`) não é saída: é resposta, e vai para o retomar normal.
  if (!existe) return false;

  const { data: esperando } = await ctx.db
    .from('fluxo_execucoes')
    .select('*')
    .eq('conversa_id', ctx.conversa.id)
    .eq('fluxo_id', fluxo.id)
    .eq('no_atual', no.id)
    .eq('estado', 'aguardando_resposta')
    .order('iniciada_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  let exec = esperando as ExecucaoLinha | null;
  // Botão antigo de um fluxo desligado não reabre nada. Mas quem está ESPERANDO o
  // clique segue — é o caso do teste de um rascunho pelo "Testar no meu WhatsApp".
  if (!exec && fluxo.status !== 'ativo') return false;
  if (!exec) {
    const { data: nova } = await ctx.db
      .from('fluxo_execucoes')
      .insert({
        fluxo_id: fluxo.id,
        conversa_id: ctx.conversa.id,
        contact_id: ctx.conversa.contact_id,
        no_atual: no.id,
        estado: 'rodando',
      })
      .select()
      .single();
    exec = nova as ExecucaoLinha | null;
    if (!exec) return false;
  }
  await evento(ctx, fluxo.id, exec.id, no.id, 'saida', alvo.saida);
  await avancar(ctx, exec, proximoNo(fluxo, no.id, alvo.saida));
  return true;
}

// ── Gatilhos ─────────────────────────────────────────────────────────────────────

async function gatilhosAtivos(ctx: Contexto, tipos: string[]): Promise<Gatilho[]> {
  const { data } = await ctx.db
    .from('fluxo_gatilhos')
    .select('*, fluxos!inner(status,connection_id)')
    .in('tipo', tipos)
    .eq('ativo', true)
    .eq('fluxos.status', 'ativo')
    .order('prioridade', { ascending: false })
    .order('criado_em', { ascending: true });
  return ((data ?? []) as (Gatilho & { fluxos: { connection_id: string | null } })[]).filter(
    (g) => !g.fluxos.connection_id || g.fluxos.connection_id === ctx.conexao.id,
  );
}

/** Abre uma execução nova e anda. Cancela quem esperava RESPOSTA nesta conversa. */
async function iniciarNoContexto(ctx: Contexto, fluxoId: string, gatilhoId: string | null): Promise<string | null> {
  const fluxo = await carregarFluxo(ctx, fluxoId);
  if (!fluxo) return null;
  const inicio = fluxo.grafo.nos.find((n) => n.tipo === 'inicio');
  if (!inicio) return null;

  // Quem esperava um clique/resposta perde a vez: a conversa mudou de assunto. Quem
  // esperava TEMPO (uma sequência de dias) continua — é outra linha do tempo.
  await ctx.db
    .from('fluxo_execucoes')
    .update({ estado: 'cancelada', acordar_em: null, concluida_em: new Date().toISOString(), erro: 'Outro fluxo começou.' })
    .eq('conversa_id', ctx.conversa.id)
    .eq('estado', 'aguardando_resposta');

  const { data: nova } = await ctx.db
    .from('fluxo_execucoes')
    .insert({
      fluxo_id: fluxo.id,
      conversa_id: ctx.conversa.id,
      contact_id: ctx.conversa.contact_id,
      gatilho_id: gatilhoId,
      no_atual: inicio.id,
      estado: 'rodando',
    })
    .select()
    .single();
  const exec = nova as ExecucaoLinha | null;
  if (!exec) return null;

  await ctx.db.rpc('sf_contar_disparo', { p_gatilho: gatilhoId, p_fluxo: fluxo.id });
  await avancar(ctx, exec, inicio.id);
  return exec.id;
}

// ── Conversa e contato ───────────────────────────────────────────────────────────

/** Variações do número no Brasil: com e sem o nono dígito. */
function variantesTelefone(waId: string): string[] {
  const d = normalizarTelefoneBR(waId);
  const out = new Set<string>([d]);
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) out.add(`${d.slice(0, 4)}9${d.slice(4)}`); // 12 → 13
  if (/^55\d{2}9\d{8}$/.test(d)) out.add(`${d.slice(0, 4)}${d.slice(5)}`); // 13 → 12
  return [...out];
}

export async function garantirConversa(
  db: Db,
  conexao: Connection,
  waId: string,
  nomePerfil: string | null,
  /** O número veio da Meta (webhook)? Então é o `wa_id` verdadeiro e prevalece. */
  daMeta = false,
): Promise<{ conversa: ConversaLinha; nova: boolean }> {
  // Procura pelas variações com e sem o nono dígito: o formulário manda 13 dígitos, a
  // Meta às vezes responde com 12 — sem isto a mesma pessoa viraria duas conversas.
  const { data: achadas } = await db
    .from('wa_conversas')
    .select('*')
    .eq('connection_id', conexao.id)
    .in('wa_id', variantesTelefone(waId))
    .limit(1);
  const existente = (achadas ?? [])[0] as ConversaLinha | undefined;
  if (existente) {
    const c = existente;
    if (daMeta && c.wa_id !== waId) {
      await db.from('wa_conversas').update({ wa_id: waId }).eq('id', c.id);
      c.wa_id = waId;
    }
    if (nomePerfil && nomePerfil !== c.nome_perfil) {
      await db.from('wa_conversas').update({ nome_perfil: nomePerfil }).eq('id', c.id);
      c.nome_perfil = nomePerfil;
    }
    if (!c.contact_id) c.contact_id = await garantirContato(db, c.id, waId, nomePerfil);
    return { conversa: c, nova: false };
  }

  const { data: criada, error } = await db
    .from('wa_conversas')
    .insert({ connection_id: conexao.id, wa_id: waId, nome_perfil: nomePerfil })
    .select()
    .single();
  if (error || !criada) {
    // Corrida: outra requisição criou no meio. Lê a dela.
    const { data } = await db.from('wa_conversas').select('*').eq('connection_id', conexao.id).eq('wa_id', waId).single();
    return { conversa: data as ConversaLinha, nova: false };
  }
  const c = criada as ConversaLinha;
  c.contact_id = await garantirContato(db, c.id, waId, nomePerfil);
  return { conversa: c, nova: true };
}

async function garantirContato(db: Db, conversaId: string, waId: string, nome: string | null): Promise<string | null> {
  const variantes = variantesTelefone(waId);
  const { data: achado } = await db.from('contacts').select('id,nome').in('telefone', variantes).limit(1).maybeSingle();
  let id = (achado as { id: string } | null)?.id ?? null;
  if (!id) {
    const { data: novo } = await db
      .from('contacts')
      .insert({ telefone: normalizarTelefoneBR(waId), nome: nome || null, origem: 'whatsapp' })
      .select('id')
      .single();
    id = (novo as { id: string } | null)?.id ?? null;
  } else if (nome && !(achado as { nome: string | null }).nome) {
    await db.from('contacts').update({ nome }).eq('id', id);
  }
  if (id) await db.from('wa_conversas').update({ contact_id: id }).eq('id', conversaId);
  return id;
}

async function montarContexto(db: Db, conexao: Connection, conversa: ConversaLinha, wamid: string | null): Promise<Contexto> {
  const ctx: Contexto = { db, conexao, conversa, contato: null, ultimaEntradaWamid: wamid, profundidade: 0, fluxos: new Map() };
  await recarregarContato(ctx);
  return ctx;
}

async function tomarConversa(db: Db, conversaId: string): Promise<boolean> {
  for (let i = 0; i < 4; i += 1) {
    const { data } = await db.rpc('sf_tomar_conversa', { p_conversa: conversaId, p_segundos: 25 });
    if (data === true) return true;
    await esperar(1500);
  }
  return false;
}

// ── Porta 1: chegou mensagem ─────────────────────────────────────────────────────

export interface ResultadoRecebimento {
  duplicada: boolean;
  fluxoIniciado: string | null;
  consumida: boolean;
}

/**
 * A pessoa mandou algo para o número. Guarda na conversa e decide qual automação
 * responde, na ordem do ManyChat:
 *
 *   1. clique num botão de fluxo → segue a seta daquele botão
 *   2. havia pergunta/botões esperando → a resposta vai para lá
 *   3. link de referência (wa.me com [ref:código])
 *   4. anúncio de clique para o WhatsApp
 *   5. palavra-chave (maior prioridade primeiro)
 *   6. boas-vindas (primeira mensagem da vida desta pessoa para o número)
 *   7. resposta padrão (nada casou; respeita o intervalo mínimo)
 */
export async function receberMensagem(
  db: Db,
  conexao: Connection,
  msg: MensagemRecebida,
  nomePerfil: string | null,
): Promise<ResultadoRecebimento> {
  const waId = String(msg.from ?? '').replace(/\D/g, '');
  const resultado: ResultadoRecebimento = { duplicada: false, fluxoIniciado: null, consumida: false };
  if (!waId) return resultado;

  const entrada = lerEntrada(msg);
  const { conversa, nova } = await garantirConversa(db, conexao, waId, nomePerfil, true);
  const quando = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

  // Idempotência: a Meta REENVIA o mesmo evento quando demoramos. O índice único do
  // wamid transforma a segunda entrega num erro de inserção — e aí paramos aqui, em
  // vez de responder duas vezes.
  const { error: dup } = await db.from('wa_mensagens').insert({
    conversa_id: conversa.id,
    direcao: 'in',
    tipo: entrada.tipo,
    texto: entrada.texto || entrada.previa,
    payload: msg as unknown as Record<string, unknown>,
    wamid: msg.id ?? null,
    criado_em: quando,
  });
  if (dup) {
    resultado.duplicada = true;
    return resultado;
  }

  // Reação não abre janela nova nem aciona robô: é um 👍 numa mensagem.
  if (entrada.tipo === 'reacao') return resultado;

  await db
    .from('wa_conversas')
    .update({
      ultima_entrada_em: quando,
      ultima_mensagem_em: quando,
      ultima_previa: entrada.previa.slice(0, 200),
      nao_lidas: (conversa.nao_lidas ?? 0) + 1,
      status: 'aberta',
    })
    .eq('id', conversa.id);
  conversa.ultima_entrada_em = quando;
  await db.from('connections').update({ ultima_entrada_em: quando }).eq('id', conexao.id);

  const ctx = await montarContexto(db, conexao, conversa, msg.id ?? null);
  if (descadastrado(ctx) || pausada(ctx)) return resultado;

  if (!(await tomarConversa(db, conversa.id))) {
    console.warn('[automacao] conversa ocupada, mensagem sem robô:', conversa.id);
    return resultado;
  }

  try {
    // 1. Clique num botão de fluxo.
    const alvo = lerIdDeResposta(entrada.idResposta);
    if (alvo && (await rotearClique(ctx, alvo))) {
      resultado.consumida = true;
      return resultado;
    }

    // 2. Havia alguém esperando resposta.
    const { data: esperando } = await db
      .from('fluxo_execucoes')
      .select('*')
      .eq('conversa_id', conversa.id)
      .eq('estado', 'aguardando_resposta')
      .order('atualizada_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (esperando && (await retomarComResposta(ctx, esperando as ExecucaoLinha, entrada))) {
      resultado.consumida = true;
      return resultado;
    }

    // 3–7. Gatilhos.
    const gatilho = await escolherGatilho(ctx, entrada, nova);
    if (gatilho) {
      if (gatilho.tipo === 'padrao') {
        await db.from('wa_conversas').update({ resposta_padrao_em: new Date().toISOString() }).eq('id', conversa.id);
      }
      resultado.fluxoIniciado = await iniciarNoContexto(ctx, gatilho.fluxo_id, gatilho.id);
    }
    return resultado;
  } catch (e) {
    console.error('[automacao] falhou ao tratar mensagem:', e);
    return resultado;
  } finally {
    await db.rpc('sf_soltar_conversa', { p_conversa: conversa.id });
  }
}

async function escolherGatilho(ctx: Contexto, entrada: Entrada, nova: boolean): Promise<Gatilho | null> {
  const todos = await gatilhosAtivos(ctx, ['link_ref', 'anuncio', 'palavra_chave', 'boas_vindas', 'padrao']);
  const deTipo = (t: string) => todos.filter((g) => g.tipo === t);

  const codigo = codigoDeReferencia(entrada.texto);
  if (codigo) {
    const g = deTipo('link_ref').find((x) => String(x.config.codigo ?? '').toLowerCase() === codigo);
    if (g) return g;
  }

  if (entrada.anuncioId || (nova && entrada.anuncioId !== null)) {
    const g = deTipo('anuncio').find((x) => {
      const ids = (x.config.ad_ids ?? []).map(String).filter(Boolean);
      return !ids.length || ids.includes(String(entrada.anuncioId));
    });
    if (g) return g;
  }

  if (entrada.texto) {
    const g = deTipo('palavra_chave').find((x) => casaPalavraChave(entrada.texto, x.config));
    if (g) return g;
  }

  if (nova) {
    const g = deTipo('boas_vindas')[0];
    if (g) return g;
  }

  const padrao = deTipo('padrao')[0];
  if (padrao) {
    const horas = Number(padrao.config.intervalo_horas ?? 24);
    const ultima = ctx.conversa.resposta_padrao_em ? new Date(ctx.conversa.resposta_padrao_em).getTime() : 0;
    if (!ultima || Date.now() - ultima >= horas * 3_600_000) return padrao;
  }
  return null;
}

// ── Porta 2: o tick ──────────────────────────────────────────────────────────────

export interface ResultadoTick {
  acordadas: number;
  erros: number;
}

/**
 * Acorda quem chegou a hora: fim de "aguarde", prazo de resposta vencido, ou rodada
 * interrompida pelo teto de passos. Chamado pelo /api/dispatch/tick.
 */
export async function rodarAutomacoes(db: Db, deadlineMs: number): Promise<ResultadoTick> {
  const out: ResultadoTick = { acordadas: 0, erros: 0 };
  const { data } = await db.rpc('sf_reivindicar_execucoes', { p_limite: 50 });
  const execs = (data ?? []) as ExecucaoLinha[];
  const conexoes = new Map<string, Connection | null>();

  for (const exec of execs) {
    if (Date.now() > deadlineMs) {
      // Sem tempo: solta a trava para o próximo tick pegar.
      await db.from('fluxo_execucoes').update({ travada_ate: null }).eq('id', exec.id);
      continue;
    }
    try {
      const { data: conv } = await db.from('wa_conversas').select('*').eq('id', exec.conversa_id).maybeSingle();
      if (!conv) continue;
      const conversa = conv as ConversaLinha;
      if (!conexoes.has(conversa.connection_id)) {
        const { data: c } = await db.from('connections').select('*').eq('id', conversa.connection_id).maybeSingle();
        conexoes.set(conversa.connection_id, (c as Connection | null) ?? null);
      }
      const conexao = conexoes.get(conversa.connection_id);
      if (!conexao || conexao.status !== 'conectada') {
        // Número caído: adia 10 min em vez de queimar o passo.
        await db
          .from('fluxo_execucoes')
          .update({ acordar_em: new Date(Date.now() + 600_000).toISOString(), travada_ate: null })
          .eq('id', exec.id);
        continue;
      }
      const ctx = await montarContexto(db, conexao, conversa, null);
      await acordar(ctx, exec);
      out.acordadas += 1;
    } catch (e) {
      out.erros += 1;
      console.error('[automacao] tick falhou na execução', exec.id, e);
      await db
        .from('fluxo_execucoes')
        .update({ estado: 'erro', erro: String(e).slice(0, 400), travada_ate: null, acordar_em: null })
        .eq('id', exec.id);
    }
  }
  return out;
}

async function acordar(ctx: Contexto, exec: ExecucaoLinha): Promise<void> {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  if (!fluxo) return concluir(ctx, exec, 'erro', 'O fluxo foi apagado.');
  // Fluxo PAUSADO no meio: quem estava esperando fica parado até reativarem. Rascunho
  // segue (é o teste pelo "Testar no meu WhatsApp").
  if (fluxo.status === 'pausado') {
    await atualizarExecucao(ctx, exec.id, { acordar_em: new Date(Date.now() + 3_600_000).toISOString(), travada_ate: null });
    return;
  }
  const tipo = String(exec.aguardando?.tipo ?? '');
  const noId = exec.no_atual;
  if (!noId) return concluir(ctx, exec, 'concluida');

  if (tipo === 'continuar') return avancar(ctx, exec, noId);
  if (tipo === 'tempo') {
    await evento(ctx, fluxo.id, exec.id, noId, 'saida', 'proximo');
    return avancar(ctx, exec, proximoNo(fluxo, noId, 'proximo'));
  }
  // Prazo de resposta vencido.
  const no = fluxo.grafo.nos.find((n) => n.id === noId);
  const saida = no?.tipo === 'pergunta' ? 'nao_respondeu' : 'sem_resposta';
  if (!saidaLigada(fluxo, noId, saida)) return concluir(ctx, exec, 'concluida');
  await evento(ctx, fluxo.id, exec.id, noId, 'saida', saida);
  return avancar(ctx, exec, proximoNo(fluxo, noId, saida));
}

// ── Porta 3: iniciar de fora ─────────────────────────────────────────────────────

/**
 * Começa um fluxo para um número — pela tela (testar, caixa de conversa) ou por um
 * sistema de fora (formulário da LP). Se a janela de 24 h estiver fechada, o fluxo
 * precisa começar por um bloco Template; o motor segue pela saída "janela fechada".
 */
export async function iniciarFluxo(
  db: Db,
  p: {
    fluxoId: string;
    conexao: Connection;
    waId: string;
    nome?: string | null;
    gatilhoId?: string | null;
    dadosContato?: { email?: string | null; tags?: string[]; campos?: Record<string, unknown> };
  },
): Promise<{ execucaoId: string | null; erro?: string }> {
  const waId = normalizarTelefoneBR(p.waId);
  if (waId.length < 10) return { execucaoId: null, erro: 'Telefone inválido.' };
  const { conversa } = await garantirConversa(db, p.conexao, waId, p.nome ?? null);
  const ctx = await montarContexto(db, p.conexao, conversa, null);

  // Dados vindos do formulário entram no contato antes do fluxo rodar — assim o
  // primeiro template já sai com {{primeiro_nome}} e o que mais vier.
  if (ctx.contato && p.dadosContato) {
    const patch: Record<string, unknown> = {};
    if (p.nome && !ctx.contato.nome) patch.nome = p.nome;
    if (p.dadosContato.email && !ctx.contato.email) patch.email = p.dadosContato.email.toLowerCase().trim();
    if (p.dadosContato.campos && Object.keys(p.dadosContato.campos).length) {
      patch.campos = { ...(ctx.contato.campos ?? {}), ...p.dadosContato.campos };
    }
    if (p.dadosContato.tags?.length) {
      const atuais = ctx.contato.tags ?? [];
      patch.tags = [...new Set([...atuais, ...p.dadosContato.tags.map((t) => t.trim()).filter(Boolean)])];
    }
    if (Object.keys(patch).length) {
      // E-mail duplicado com outro contato quebraria o update inteiro: tenta sem ele.
      const { error } = await db.from('contacts').update(patch).eq('id', ctx.contato.id);
      if (error && patch.email) {
        delete patch.email;
        await db.from('contacts').update(patch).eq('id', ctx.contato.id);
      }
      await recarregarContato(ctx);
    }
  }

  if (descadastrado(ctx)) return { execucaoId: null, erro: 'Este contato pediu para não receber WhatsApp.' };
  const execucaoId = await iniciarNoContexto(ctx, p.fluxoId, p.gatilhoId ?? null);
  return execucaoId ? { execucaoId } : { execucaoId: null, erro: 'O fluxo não tem bloco Início.' };
}

/** Manda uma mensagem manual (caixa de conversa). Texto livre só dentro da janela. */
export async function responderManual(
  db: Db,
  conexao: Connection,
  conversaId: string,
  corpo: CorpoMeta,
  pausarHoras = 0,
): Promise<{ erro: string | null }> {
  const { data } = await db.from('wa_conversas').select('*').eq('id', conversaId).maybeSingle();
  if (!data) return { erro: 'Conversa não encontrada.' };
  const ctx = await montarContexto(db, conexao, data as ConversaLinha, null);
  if (corpo.type !== 'template' && !janelaAberta(ctx.conversa.ultima_entrada_em)) {
    return { erro: 'A janela de 24 h está fechada. Só dá para mandar um template aprovado.' };
  }
  const erro = await mandar(ctx, corpo, { tipo: 'manual' });
  if (!erro && pausarHoras > 0) {
    await db
      .from('wa_conversas')
      .update({ automacao_pausada_ate: new Date(Date.now() + pausarHoras * 3_600_000).toISOString() })
      .eq('id', conversaId);
  }
  return { erro };
}
