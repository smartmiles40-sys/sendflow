// A parte PURA do motor de automações: sem banco, sem rede.
//
// Tudo que decide O QUE sai e PARA ONDE o fluxo vai está aqui — montar o corpo que a
// Meta espera, entender o que a pessoa mandou, casar palavra-chave, avaliar condição,
// calcular até quando esperar. O motor (motor.ts) só busca os dados, chama estas
// funções e grava o resultado. Separar assim é o que deixa testar cada regra sem
// subir servidor nem gastar mensagem.

import { isoDeSP, partesSP } from '../hora-sp';
import type {
  Bloco,
  DadosAguardar,
  DadosCondicao,
  DadosMensagem,
  DadosPergunta,
  GatilhoConfig,
  Regra,
  TipoResposta,
  Variante,
} from './tipos';
import { LIMITES } from './tipos';

// ── Personalização ───────────────────────────────────────────────────────────────

export interface Pessoa {
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  tags?: string[];
  campos?: Record<string, unknown>;
}

function primeiroNome(nome: string | null | undefined): string {
  const n = String(nome ?? '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

/**
 * `{{primeiro_nome}}`, `{{nome}}`, `{{telefone}}`, `{{email}}` e qualquer campo
 * personalizado (`{{cidade}}`). Variável desconhecida vira vazio — "Oi {{nome}}"
 * aparecendo cru no WhatsApp da pessoa é pior do que "Oi ".
 *
 * Diferente do e-mail, NÃO escapa HTML: WhatsApp é texto puro, e "Silva & Cia"
 * viraria "Silva &amp; Cia" na tela.
 */
export function personalizar(texto: string, p: Pessoa): string {
  const mapa: Record<string, string> = {
    nome: String(p.nome ?? '').trim(),
    primeiro_nome: primeiroNome(p.nome),
    email: String(p.email ?? ''),
    telefone: String(p.telefone ?? ''),
  };
  for (const [k, v] of Object.entries(p.campos ?? {})) {
    if (v !== null && v !== undefined) mapa[k.toLowerCase()] = String(v);
  }
  return String(texto ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, chave: string) => mapa[chave.trim().toLowerCase()] ?? '');
}

const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── Montagem das mensagens ───────────────────────────────────────────────────────

export type CorpoMeta = Record<string, unknown>;

function corpoDeMidia(b: Exclude<Bloco, { tipo: 'texto' }>, p: Pessoa): CorpoMeta {
  const chave = b.tipo === 'documento' ? 'document' : b.tipo === 'imagem' ? 'image' : b.tipo;
  const midia: Record<string, unknown> = { link: b.url };
  // Áudio não aceita legenda na Meta; mandar dá erro 100.
  if (b.legenda && b.tipo !== 'audio') midia.caption = corta(personalizar(b.legenda, p), LIMITES.legenda);
  if (b.tipo === 'documento') midia.filename = b.nome || 'documento.pdf';
  return { type: chave, [chave]: midia };
}

/**
 * Um nó de mensagem → a lista de corpos que saem, NA ORDEM.
 *
 * A interação (botões, lista, link) vai presa ao ÚLTIMO texto: a Meta exige um corpo
 * de texto na mensagem interativa, e é assim que o ManyChat também mostra — o texto em
 * cima, os botões embaixo, numa bolha só.
 */
export function montarMensagens(d: DadosMensagem, p: Pessoa, prefixoId = ''): CorpoMeta[] {
  const saem: CorpoMeta[] = [];
  const blocos = d.blocos ?? [];
  const interativa = d.interacao && d.interacao.tipo !== 'nenhuma';
  const ultimoTexto = interativa && blocos[blocos.length - 1]?.tipo === 'texto' ? blocos.length - 1 : -1;

  blocos.forEach((b, i) => {
    if (b.tipo !== 'texto') {
      saem.push(corpoDeMidia(b, p));
      return;
    }
    const texto = personalizar(b.texto, p);
    if (!texto.trim()) return;
    if (i !== ultimoTexto) {
      saem.push({ type: 'text', text: { body: corta(texto, LIMITES.texto), preview_url: /https?:\/\//.test(texto) } });
      return;
    }
    saem.push(montarInterativa(d, texto, p, prefixoId));
  });
  return saem;
}

function montarInterativa(d: DadosMensagem, texto: string, p: Pessoa, prefixoId: string): CorpoMeta {
  const it = d.interacao;
  const base: Record<string, unknown> = { body: { text: corta(texto, LIMITES.textoInterativo) } };
  if (d.cabecalho?.trim()) base.header = { type: 'text', text: corta(personalizar(d.cabecalho, p), LIMITES.cabecalho) };
  if (d.rodape?.trim()) base.footer = { text: corta(personalizar(d.rodape, p), LIMITES.rodape) };

  if (it.tipo === 'botoes') {
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        ...base,
        action: {
          buttons: it.botoes.slice(0, LIMITES.botoes).map((b) => ({
            type: 'reply',
            reply: { id: `${prefixoId}${b.id}`, title: corta(personalizar(b.titulo, p), LIMITES.tituloBotao) },
          })),
        },
      },
    };
  }
  if (it.tipo === 'lista') {
    return {
      type: 'interactive',
      interactive: {
        type: 'list',
        ...base,
        action: {
          button: corta(it.rotuloBotao || 'Ver opções', LIMITES.rotuloBotaoLista),
          sections: it.secoes.map((s) => ({
            ...(s.titulo ? { title: corta(s.titulo, 24) } : {}),
            rows: s.itens.map((i) => ({
              id: `${prefixoId}${i.id}`,
              title: corta(personalizar(i.titulo, p), LIMITES.tituloItem),
              ...(i.descricao ? { description: corta(personalizar(i.descricao, p), LIMITES.descricaoItem) } : {}),
            })),
          })),
        },
      },
    };
  }
  if (it.tipo === 'link') {
    return {
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        ...base,
        action: {
          name: 'cta_url',
          parameters: { display_text: corta(it.rotulo, LIMITES.tituloBotao), url: personalizar(it.url, p) },
        },
      },
    };
  }
  return { type: 'text', text: { body: texto } };
}

// ── Id do clique ─────────────────────────────────────────────────────────────────
//
// Todo botão que sai de um fluxo leva no id o endereço completo de onde ele leva:
// `f:<fluxo>:<nó>:<saída>`. Assim um clique chega certo MESMO dias depois, mesmo que
// a pessoa tenha passado por outro fluxo no meio, ou clicado num botão de uma mensagem
// antiga — o ManyChat funciona assim, e é o que as pessoas esperam de um botão.

export function prefixoDeResposta(fluxoId: string, noId: string): string {
  return `f:${fluxoId}:${noId}:`;
}

export function lerIdDeResposta(id: string | null | undefined): { fluxoId: string; noId: string; saida: string } | null {
  const m = String(id ?? '').match(/^f:([0-9a-f-]{36}):([^:]+):(.+)$/i);
  return m ? { fluxoId: m[1], noId: m[2], saida: m[3] } : null;
}

/** A pergunta: texto puro, ou com as sugestões como botões de resposta. */
export function montarPergunta(d: DadosPergunta, p: Pessoa, prefixoId: string): CorpoMeta {
  const texto = personalizar(d.pergunta, p);
  const sugestoes = (d.sugestoes ?? []).filter((s) => s.trim()).slice(0, LIMITES.botoes);
  if (!sugestoes.length) return { type: 'text', text: { body: corta(texto, LIMITES.texto) } };
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: corta(texto, LIMITES.textoInterativo) },
      action: {
        buttons: sugestoes.map((s, i) => ({
          type: 'reply',
          reply: { id: `${prefixoId}_s${i}`, title: corta(s, LIMITES.tituloBotao) },
        })),
      },
    },
  };
}

/** Uma linha legível do que saiu, para a caixa de conversa e a prévia da lista. */
export function previaDoCorpo(c: CorpoMeta): string {
  const t = String(c.type ?? '');
  if (t === 'text') return String((c.text as { body?: string })?.body ?? '');
  if (t === 'interactive') {
    const i = c.interactive as { body?: { text?: string } };
    return String(i?.body?.text ?? '');
  }
  if (t === 'template') return `[template ${(c.template as { name?: string })?.name ?? ''}]`;
  const rotulo: Record<string, string> = { image: 'imagem', video: 'vídeo', audio: 'áudio', document: 'documento' };
  const legenda = (c[t] as { caption?: string } | undefined)?.caption;
  return legenda ? `[${rotulo[t] ?? t}] ${legenda}` : `[${rotulo[t] ?? t}]`;
}

/** O tipo que a caixa de conversa usa para desenhar a bolha. */
export function tipoDoCorpo(c: CorpoMeta): string {
  const t = String(c.type ?? '');
  if (t === 'text') return 'texto';
  if (t === 'interactive') {
    const it = String((c.interactive as { type?: string })?.type ?? '');
    return it === 'button' ? 'botoes' : it === 'list' ? 'lista' : it === 'cta_url' ? 'link' : 'interativa';
  }
  const mapa: Record<string, string> = { image: 'imagem', video: 'video', audio: 'audio', document: 'documento', template: 'template' };
  return mapa[t] ?? t;
}

// ── O que a pessoa mandou ────────────────────────────────────────────────────────

export interface MensagemRecebida {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
    nfm_reply?: { response_json?: string };
  };
  image?: { id?: string; caption?: string; mime_type?: string };
  video?: { id?: string; caption?: string };
  audio?: { id?: string; voice?: boolean };
  document?: { id?: string; caption?: string; filename?: string };
  sticker?: { id?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  reaction?: { message_id?: string; emoji?: string };
  context?: { id?: string; from?: string };
  /** Veio de anúncio de clique para o WhatsApp. */
  referral?: { source_id?: string; source_type?: string; source_url?: string; headline?: string; ctwa_clid?: string };
}

export interface Entrada {
  /** texto | resposta_botao | resposta_lista | imagem | video | audio | documento | … */
  tipo: string;
  /** O texto que conta para palavra-chave e para responder pergunta. */
  texto: string;
  /** Id do botão/opção clicado, quando é clique. */
  idResposta: string | null;
  /** Id do anúncio, quando a conversa começou por um. */
  anuncioId: string | null;
  previa: string;
}

/** Normaliza qualquer mensagem da Meta para o que o motor precisa. */
export function lerEntrada(m: MensagemRecebida): Entrada {
  const anuncioId = m.referral?.source_type === 'ad' || m.referral?.source_id ? String(m.referral?.source_id ?? '') || null : null;
  const base = { anuncioId };
  switch (m.type) {
    case 'text':
      return { ...base, tipo: 'texto', texto: m.text?.body ?? '', idResposta: null, previa: m.text?.body ?? '' };
    case 'interactive': {
      if (m.interactive?.button_reply) {
        const t = m.interactive.button_reply.title ?? '';
        return { ...base, tipo: 'resposta_botao', texto: t, idResposta: m.interactive.button_reply.id ?? null, previa: t };
      }
      if (m.interactive?.list_reply) {
        const t = m.interactive.list_reply.title ?? '';
        return { ...base, tipo: 'resposta_lista', texto: t, idResposta: m.interactive.list_reply.id ?? null, previa: t };
      }
      return { ...base, tipo: 'interativa', texto: '', idResposta: null, previa: '[resposta]' };
    }
    case 'button': {
      // Botão de resposta rápida de TEMPLATE: vem com o texto e o payload.
      const t = m.button?.text ?? '';
      return { ...base, tipo: 'resposta_botao', texto: t, idResposta: m.button?.payload ?? null, previa: t };
    }
    case 'image':
      return { ...base, tipo: 'imagem', texto: m.image?.caption ?? '', idResposta: null, previa: `[imagem] ${m.image?.caption ?? ''}`.trim() };
    case 'video':
      return { ...base, tipo: 'video', texto: m.video?.caption ?? '', idResposta: null, previa: `[vídeo] ${m.video?.caption ?? ''}`.trim() };
    case 'audio':
      return { ...base, tipo: 'audio', texto: '', idResposta: null, previa: '[áudio]' };
    case 'document':
      return { ...base, tipo: 'documento', texto: m.document?.caption ?? '', idResposta: null, previa: `[documento] ${m.document?.filename ?? ''}`.trim() };
    case 'sticker':
      return { ...base, tipo: 'figurinha', texto: '', idResposta: null, previa: '[figurinha]' };
    case 'location':
      return { ...base, tipo: 'localizacao', texto: m.location?.address ?? m.location?.name ?? '', idResposta: null, previa: '[localização]' };
    case 'contacts':
      return { ...base, tipo: 'contato', texto: '', idResposta: null, previa: '[contato]' };
    case 'reaction':
      return { ...base, tipo: 'reacao', texto: '', idResposta: null, previa: `reagiu ${m.reaction?.emoji ?? ''}`.trim() };
    default:
      return { ...base, tipo: 'outro', texto: '', idResposta: null, previa: `[${m.type ?? 'mensagem'}]` };
  }
}

// ── Palavra-chave ────────────────────────────────────────────────────────────────

/** Minúsculas, sem acento, sem pontuação, espaços únicos. "Japão!!" → "japao". */
export function normalizarTexto(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A pessoa escreveu a palavra? `contem` casa PALAVRA INTEIRA, não pedaço: "peru" não
 * dispara com "perguntar" — que é o erro mais comum de robô de palavra-chave, e o
 * mais irritante para quem está do outro lado.
 */
export function casaPalavraChave(texto: string, cfg: GatilhoConfig): boolean {
  const alvo = normalizarTexto(texto);
  if (!alvo) return false;
  const modo = cfg.modo ?? 'contem';
  return (cfg.palavras ?? []).some((bruta) => {
    const p = normalizarTexto(bruta);
    if (!p) return false;
    if (modo === 'exata') return alvo === p;
    if (modo === 'comeca') return alvo === p || alvo.startsWith(`${p} `);
    return ` ${alvo} `.includes(` ${p} `);
  });
}

/** O texto pré-preenchido do link wa.me carrega o código: "… [ref:live-peru]". */
export function codigoDeReferencia(texto: string): string | null {
  const m = String(texto ?? '').match(/\[ref:([a-z0-9_-]{2,40})\]/i);
  return m ? m[1].toLowerCase() : null;
}

/** O link wa.me que a tela mostra para copiar (e colocar na LP, na bio, no QR). */
export function linkDeReferencia(numero: string, codigo: string, texto?: string): string {
  const frase = `${(texto ?? '').trim() || 'Olá!'} [ref:${codigo}]`;
  return `https://wa.me/${String(numero).replace(/\D/g, '')}?text=${encodeURIComponent(frase)}`;
}

// ── Resposta da pergunta ─────────────────────────────────────────────────────────

/** Confere e normaliza a resposta. `null` = inválida, pergunta de novo. */
export function validarResposta(tipo: TipoResposta, bruto: string): string | null {
  const v = String(bruto ?? '').trim();
  if (!v) return null;
  switch (tipo) {
    case 'numero': {
      const n = Number(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) && /\d/.test(v) ? String(n) : null;
    }
    case 'email': {
      const e = v.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
    }
    case 'telefone': {
      const d = v.replace(/\D/g, '');
      if (d.length === 10 || d.length === 11) return `55${d}`;
      return d.length >= 12 && d.length <= 15 ? d : null;
    }
    case 'data': {
      const m = v.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
      if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      const dia = Number(m[1]);
      const mes = Number(m[2]);
      let ano = m[3] ? Number(m[3]) : new Date().getFullYear();
      if (ano < 100) ano += 2000;
      if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
      return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    default:
      return v.slice(0, 1000);
  }
}

// ── Condição ─────────────────────────────────────────────────────────────────────

export interface ContextoCondicao extends Pessoa {
  janelaAberta: boolean;
  inscritoWhatsapp: boolean;
}

function valorDoCampo(r: Regra, c: ContextoCondicao): string {
  switch (r.campo) {
    case 'nome':
      return String(c.nome ?? '');
    case 'email':
      return String(c.email ?? '');
    case 'telefone':
      return String(c.telefone ?? '');
    case 'campo': {
      const v = c.campos?.[r.chave ?? ''];
      return v === null || v === undefined ? '' : String(v);
    }
    default:
      return '';
  }
}

export function avaliarRegra(r: Regra, c: ContextoCondicao): boolean {
  if (r.campo === 'tag') {
    const tem = (c.tags ?? []).some((t) => normalizarTexto(t) === normalizarTexto(r.valor ?? ''));
    return r.operador === 'nao_tem' ? !tem : tem;
  }
  if (r.campo === 'janela_aberta') return r.operador === 'nao_tem' || r.operador === 'diferente' ? !c.janelaAberta : c.janelaAberta;
  if (r.campo === 'inscrito_whatsapp') {
    return r.operador === 'nao_tem' || r.operador === 'diferente' ? !c.inscritoWhatsapp : c.inscritoWhatsapp;
  }

  const atual = valorDoCampo(r, c);
  const a = normalizarTexto(atual);
  const b = normalizarTexto(r.valor ?? '');
  const na = Number(atual.replace(',', '.'));
  const nb = Number(String(r.valor ?? '').replace(',', '.'));
  switch (r.operador) {
    case 'igual':
      return a === b;
    case 'diferente':
      return a !== b;
    case 'contem':
      return b ? a.includes(b) : false;
    case 'nao_contem':
      return b ? !a.includes(b) : true;
    case 'vazio':
      return !atual.trim();
    case 'preenchido':
    case 'tem':
      return Boolean(atual.trim());
    case 'nao_tem':
      return !atual.trim();
    case 'maior':
      return Number.isFinite(na) && Number.isFinite(nb) ? na > nb : atual > String(r.valor ?? '');
    case 'menor':
      return Number.isFinite(na) && Number.isFinite(nb) ? na < nb : atual < String(r.valor ?? '');
  }
}

export function avaliarCondicao(d: DadosCondicao, c: ContextoCondicao): boolean {
  if (!d.regras.length) return false;
  return d.combinar === 'qualquer' ? d.regras.some((r) => avaliarRegra(r, c)) : d.regras.every((r) => avaliarRegra(r, c));
}

// ── Teste A/B ────────────────────────────────────────────────────────────────────

export function escolherVariante(variantes: Variante[], sorteio = Math.random()): Variante | null {
  const validas = variantes.filter((v) => v.peso > 0);
  const total = validas.reduce((s, v) => s + v.peso, 0);
  if (!total) return null;
  let alvo = sorteio * total;
  for (const v of validas) {
    alvo -= v.peso;
    if (alvo < 0) return v;
  }
  return validas[validas.length - 1];
}

// ── Aguardar ─────────────────────────────────────────────────────────────────────

const MS: Record<string, number> = { minutos: 60_000, horas: 3_600_000, dias: 86_400_000 };

function minutosDoDia(hhmm: string): number | null {
  const m = String(hhmm ?? '').match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Até quando esperar. Com faixa de horário, o fim da espera que cair fora da faixa é
 * empurrado para a próxima abertura — "espere 1 dia, mas só mande entre 9h e 20h" não
 * pode acordar a pessoa às 3h da manhã só porque ela escreveu de madrugada.
 */
export function calcularAcordar(d: DadosAguardar, agora: Date): Date {
  const passo = Math.max(1, Number(d.quantidade) || 1) * (MS[d.unidade] ?? MS.minutos);
  const alvo = new Date(agora.getTime() + passo);
  const ini = minutosDoDia(d.janelaInicio ?? '');
  const fim = minutosDoDia(d.janelaFim ?? '');
  if (ini === null || fim === null || ini === fim) return alvo;

  const { data, hora } = partesSP(alvo.toISOString());
  const agoraMin = minutosDoDia(hora) ?? 0;
  const dentro = ini < fim ? agoraMin >= ini && agoraMin < fim : agoraMin >= ini || agoraMin < fim;
  if (dentro) return alvo;

  const hhmm = d.janelaInicio as string;
  // Antes da abertura de hoje → hoje na abertura; depois → amanhã na abertura.
  if (ini < fim && agoraMin < ini) return new Date(isoDeSP(data, hhmm) ?? alvo.toISOString());
  const amanha = new Date(new Date(`${data}T12:00:00-03:00`).getTime() + 86_400_000);
  const dataAmanha = partesSP(amanha.toISOString()).data;
  if (ini > fim) return new Date(isoDeSP(data, hhmm) ?? alvo.toISOString());
  return new Date(isoDeSP(dataAmanha, hhmm) ?? alvo.toISOString());
}
