// Regras das automações do Instagram — a parte PURA (sem banco, sem rede), testável.
//
// Decide QUAL automação responde a um evento e MONTA o que sai. Quem busca as
// automações no banco e quem manda para a Meta é o motor (motor.ts).

export type GatilhoIg = 'comentario' | 'dm_palavra' | 'story_resposta' | 'story_mencao' | 'boas_vindas';

export interface BotaoLink {
  titulo: string;
  url: string;
}

export interface ConfigAutomacaoIg {
  /** Palavras que disparam (comentário e DM). Vazio + qualquer_palavra = qualquer texto. */
  palavras?: string[];
  qualquer_palavra?: boolean;
  /** Só comentário: ids dos posts. Vazio = todos os posts. */
  posts?: string[];
  /** Só comentário: respostas públicas no próprio comentário (sorteia uma). */
  respostas_publicas?: string[];
  /** A mensagem privada (DM). */
  dm_texto?: string;
  dm_botoes?: BotaoLink[];
  /** Tags postas na conversa de quem disparou. */
  tags?: string[];
}

export interface AutomacaoIg {
  id: string;
  nome: string;
  ativo: boolean;
  gatilho: GatilhoIg;
  config: ConfigAutomacaoIg;
  criado_em?: string;
}

export const ROTULO_GATILHO: Record<GatilhoIg, string> = {
  comentario: 'Comentário em post',
  dm_palavra: 'Palavra-chave na DM',
  story_resposta: 'Resposta a story',
  story_mencao: 'Menção em story',
  boas_vindas: 'Primeira mensagem (boas-vindas)',
};

/** Minúsculas, sem acento e sem pontuação — "JAPÃO!!" casa com "japao". */
export function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#@]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A palavra aparece no texto como palavra (ou expressão) inteira: "eu quero" casa com
 * "EU QUERO!!!", mas "eu" não casa com "europa" — o erro clássico do "contém" puro,
 * que faz o robô responder "Quero o roteiro" para quem comentou "neutro".
 */
export function casaPalavra(texto: string, palavra: string): boolean {
  const t = ` ${normalizar(texto)} `;
  const p = normalizar(palavra);
  if (!p) return false;
  return t.includes(` ${p} `);
}

export function casaAlguma(texto: string, cfg: ConfigAutomacaoIg): boolean {
  const palavras = (cfg.palavras ?? []).filter((p) => normalizar(p));
  if (!palavras.length) return Boolean(cfg.qualquer_palavra);
  return palavras.some((p) => casaPalavra(texto, p));
}

/**
 * Qual automação responde a um comentário. Ordem: as que filtram por POST antes das
 * de "todos os posts", e as de palavra antes das de "qualquer comentário" — a mais
 * específica ganha, como no ManyChat.
 */
export function escolherParaComentario(automacoes: AutomacaoIg[], texto: string, mediaId: string | null): AutomacaoIg | null {
  const candidatas = automacoes.filter((a) => {
    if (!a.ativo || a.gatilho !== 'comentario') return false;
    const posts = a.config.posts ?? [];
    if (posts.length && (!mediaId || !posts.includes(mediaId))) return false;
    return casaAlguma(texto, a.config);
  });
  return ordenarPorEspecificidade(candidatas)[0] ?? null;
}

export function escolherParaDm(
  automacoes: AutomacaoIg[],
  evento: { texto: string; ehRespostaStory: boolean; ehMencaoStory: boolean; primeiraMensagem: boolean },
): AutomacaoIg | null {
  const ativas = automacoes.filter((a) => a.ativo);
  const doTipo = (g: GatilhoIg) => ordenarPorEspecificidade(ativas.filter((a) => a.gatilho === g));

  if (evento.ehMencaoStory) return doTipo('story_mencao')[0] ?? null;
  if (evento.ehRespostaStory) {
    const r = doTipo('story_resposta').find((a) => casaAlguma(evento.texto, { ...a.config, qualquer_palavra: a.config.qualquer_palavra ?? !(a.config.palavras ?? []).length }));
    if (r) return r;
  }
  const porPalavra = doTipo('dm_palavra').find((a) => casaAlguma(evento.texto, a.config));
  if (porPalavra) return porPalavra;
  if (evento.primeiraMensagem) return doTipo('boas_vindas')[0] ?? null;
  return null;
}

function ordenarPorEspecificidade(lista: AutomacaoIg[]): AutomacaoIg[] {
  const peso = (a: AutomacaoIg) => ((a.config.posts ?? []).length ? 2 : 0) + ((a.config.palavras ?? []).length ? 1 : 0);
  return [...lista].sort((x, y) => peso(y) - peso(x) || String(x.criado_em ?? '').localeCompare(String(y.criado_em ?? '')));
}

/** Troca {{nome}} e {{usuario}} — a personalização que o ManyChat chama de "first name". */
export function personalizar(texto: string, pessoa: { nome?: string | null; username?: string | null }): string {
  const primeiro = String(pessoa.nome ?? '').trim().split(/\s+/)[0] || String(pessoa.username ?? '').trim() || '';
  return String(texto ?? '')
    .replace(/\{\{\s*nome\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*usuario\s*\}\}/gi, pessoa.username ? `@${pessoa.username}` : primeiro)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .trim();
}

/**
 * Corpo `message` da API do Instagram. Com botões vira o template de botão (até 3,
 * título até 20 caracteres, texto até 640); sem botões, texto puro (até 1000).
 */
export function montarMensagem(texto: string, botoes: BotaoLink[] = []): Record<string, unknown> {
  const validos = botoes.filter((b) => b.titulo?.trim() && /^https?:\/\//i.test(b.url ?? '')).slice(0, 3);
  if (!validos.length) return { text: texto.slice(0, 1000) };
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: texto.slice(0, 640),
        buttons: validos.map((b) => ({ type: 'web_url', url: b.url.trim(), title: b.titulo.trim().slice(0, 20) })),
      },
    },
  };
}

export function sortear<T>(lista: T[], aleatorio: () => number = Math.random): T | null {
  if (!lista.length) return null;
  return lista[Math.floor(aleatorio() * lista.length)] ?? lista[0];
}

/** Janela de 24 h do Instagram para mensagem livre. */
export function janelaAberta(ultimaEntrada: string | null | undefined, agora: Date = new Date()): boolean {
  if (!ultimaEntrada) return false;
  return agora.getTime() - Date.parse(ultimaEntrada) < 24 * 60 * 60 * 1000;
}

/** Confere e limpa a config que vem da tela. */
export function validarAutomacao(
  entrada: Record<string, unknown>,
): { ok: true; valor: { nome: string; gatilho: GatilhoIg; ativo: boolean; config: ConfigAutomacaoIg } } | { ok: false; erro: string } {
  const nome = String(entrada.nome ?? '').trim();
  if (!nome) return { ok: false, erro: 'Dê um nome à automação.' };
  const gatilho = String(entrada.gatilho ?? '') as GatilhoIg;
  if (!(gatilho in ROTULO_GATILHO)) return { ok: false, erro: 'Escolha o gatilho.' };
  const c = (entrada.config ?? {}) as Record<string, unknown>;
  const lista = (v: unknown) =>
    (Array.isArray(v) ? v : String(v ?? '').split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean);

  const config: ConfigAutomacaoIg = {
    palavras: lista(c.palavras).slice(0, 30),
    qualquer_palavra: Boolean(c.qualquer_palavra),
    posts: gatilho === 'comentario' ? lista(c.posts).filter((p) => /^\d+$/.test(p)).slice(0, 50) : [],
    respostas_publicas: gatilho === 'comentario' ? (Array.isArray(c.respostas_publicas) ? c.respostas_publicas : String(c.respostas_publicas ?? '').split('\n')).map((x) => String(x).trim()).filter(Boolean).slice(0, 10) : [],
    dm_texto: String(c.dm_texto ?? '').trim(),
    dm_botoes: (Array.isArray(c.dm_botoes) ? c.dm_botoes : [])
      .map((b) => ({ titulo: String((b as BotaoLink).titulo ?? '').trim(), url: String((b as BotaoLink).url ?? '').trim() }))
      .filter((b) => b.titulo || b.url)
      .slice(0, 3),
    tags: lista(c.tags).map((t) => t.toLowerCase()).slice(0, 10),
  };

  if ((gatilho === 'comentario' || gatilho === 'dm_palavra') && !config.palavras?.length && !config.qualquer_palavra) {
    return { ok: false, erro: 'Informe as palavras-chave ou marque "qualquer texto".' };
  }
  if (!config.dm_texto && !config.respostas_publicas?.length) {
    return { ok: false, erro: 'Escreva a mensagem privada (ou, no comentário, uma resposta pública).' };
  }
  if ((config.dm_texto ?? '').length > 1000) return { ok: false, erro: 'A mensagem passa de 1.000 caracteres.' };
  for (const b of config.dm_botoes ?? []) {
    if (!b.titulo || !/^https?:\/\//i.test(b.url)) return { ok: false, erro: 'Cada botão precisa de título e de um link começando com https://.' };
    if (b.titulo.length > 20) return { ok: false, erro: `O botão "${b.titulo}" passa de 20 caracteres.` };
  }
  if (config.dm_botoes?.length && (config.dm_texto ?? '').length > 640) {
    return { ok: false, erro: 'Com botões, a mensagem pode ter até 640 caracteres.' };
  }
  return { ok: true, valor: { nome, gatilho, ativo: entrada.ativo === undefined ? true : Boolean(entrada.ativo), config } };
}
