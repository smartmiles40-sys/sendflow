// Cliente da WhatsApp Cloud API (Meta) — o conector do disparo em massa.
//
// A diferença para a Evolution não é de fornecedor, é de NATUREZA:
//
//   Evolution                          Cloud API (aqui)
//   ─────────────────────────────      ─────────────────────────────────────────
//   chip lido por QR Code              número registrado no Business Manager
//   texto livre para qualquer um       template APROVADO para quem nunca escreveu
//   8–15 s entre mensagens             dezenas por segundo, sem jitter
//   ~500/dia antes do bloqueio         milhares/dia conforme o tier do número
//   envia para GRUPO                   não envia para grupo (a Meta não expõe)
//   ACK por participante: não vem      ACK por destinatário, confiável
//
// Por isso os dois convivem: grupo é Evolution, massa é aqui. A regra está no banco
// (0019) e na validação da API, não na boa vontade de quem usa a tela.
//
// O token NÃO fica no banco: `META_ACCESS_TOKEN` é lida no servidor, como a
// EVOLUTION_API_KEY. O que o banco guarda é o `phone_number_id`, que sozinho não
// dá acesso a nada.

export interface CloudConfig {
  token: string;
  versao: string;
  /** Segredo do app, para conferir a assinatura do webhook da Meta. */
  appSecret: string;
  /** Token de verificação que a Meta manda no GET ao cadastrar o webhook. */
  verifyToken: string;
}

/**
 * Erro previsto do conector, já em português e já classificado.
 *
 * `permanente` decide o destino da linha na fila: repetir um 131026 ("este número não
 * tem WhatsApp") é queimar tentativa à toa, enquanto repetir um 130429 (limite de
 * ritmo) é exatamente o certo a fazer.
 *
 * `esperarMs` existe porque a Meta às vezes DIZ quanto esperar. Ignorar isso e tentar
 * de novo em 1 s é o que transforma um limite momentâneo numa fila inteira em `falha`.
 */
export class CloudError extends Error {
  readonly status: number;
  readonly codigo: string | null;
  readonly permanente: boolean;
  readonly esperarMs: number;
  /** Erro que condena o NÚMERO, não a mensagem: derruba a conexão em vez de insistir. */
  readonly derrubaConexao: boolean;

  constructor(
    mensagem: string,
    opts: {
      status?: number;
      codigo?: string | number | null;
      permanente?: boolean;
      esperarMs?: number;
      derrubaConexao?: boolean;
    } = {},
  ) {
    super(mensagem);
    this.name = 'CloudError';
    this.status = opts.status ?? 0;
    this.codigo = opts.codigo === undefined || opts.codigo === null ? null : String(opts.codigo);
    this.permanente = Boolean(opts.permanente);
    this.esperarMs = opts.esperarMs ?? 0;
    this.derrubaConexao = Boolean(opts.derrubaConexao);
  }
}

/**
 * Versão da Graph API. Fica em variável de ambiente porque a Meta aposenta versão a
 * cada ~2 anos e trocar não pode exigir deploy de código.
 */
const VERSAO_PADRAO = 'v23.0';
const TIMEOUT_MS = 20_000;

export function lerConfigCloud(): CloudConfig {
  const token = (process.env.META_ACCESS_TOKEN ?? '').trim();
  if (!token) {
    throw new CloudError(
      'API oficial do WhatsApp não configurada. Defina META_ACCESS_TOKEN nas variáveis de ambiente.',
      { status: 503, permanente: true },
    );
  }
  return {
    token,
    versao: (process.env.META_API_VERSION ?? VERSAO_PADRAO).trim() || VERSAO_PADRAO,
    appSecret: (process.env.META_APP_SECRET ?? '').trim(),
    verifyToken: (process.env.META_WEBHOOK_VERIFY_TOKEN ?? '').trim(),
  };
}

/** Dá para falar com a Meta? Usado pela tela para explicar o que falta configurar. */
export function cloudConfigurada(): boolean {
  return Boolean((process.env.META_ACCESS_TOKEN ?? '').trim());
}

// ── Códigos de erro da Meta ──────────────────────────────────────────────────────
//
// A Graph API devolve 400 para quase tudo; quem separa "desista" de "tente de novo" é
// o `error.code`. Esta tabela é a tradução, e é ela que evita os dois desastres
// simétricos: desistir de uma fila inteira por um limite de 30 segundos, e martelar a
// Meta com um template que foi reprovado e nunca mais vai passar.

interface Classificacao {
  frase: string;
  permanente: boolean;
  derrubaConexao?: boolean;
  esperarMs?: number;
}

const CODIGOS: Record<string, Classificacao> = {
  // ── Desista: o problema é desta mensagem ou deste destinatário ──
  '131026': { frase: 'este número não tem WhatsApp ou não pode receber mensagens', permanente: true },
  '131047': {
    frase: 'passaram mais de 24 h desde a última resposta desta pessoa — só template pode ser enviado agora',
    permanente: true,
  },
  '131051': { frase: 'tipo de mensagem não suportado pela API oficial', permanente: true },
  '131053': { frase: 'a Meta não conseguiu baixar a mídia da URL informada', permanente: true },
  '132000': {
    frase: 'o número de variáveis enviado não bate com o que o template espera',
    permanente: true,
  },
  '132001': { frase: 'template inexistente ou não aprovado neste idioma', permanente: true },
  '132005': { frase: 'o texto final do template ficou longo demais', permanente: true },
  '132007': { frase: 'o conteúdo violou a política de template da Meta', permanente: true },
  '132012': { frase: 'o formato de uma das variáveis não bate com o template', permanente: true },
  '132015': { frase: 'este template está PAUSADO pela Meta por baixa qualidade', permanente: true },
  '132016': { frase: 'este template foi DESABILITADO pela Meta', permanente: true },
  '100': { frase: 'a Meta recusou o pedido (parâmetro inválido)', permanente: true },

  // ── Tente de novo: o problema passa ──
  '130429': {
    frase: 'limite de ritmo da Meta atingido — o motor vai diminuir o passo',
    permanente: false,
    esperarMs: 30_000,
  },
  '131056': {
    frase: 'muitas mensagens para este mesmo número em pouco tempo',
    permanente: false,
    esperarMs: 60_000,
  },
  '80007': { frase: 'limite de chamadas da Graph API atingido', permanente: false, esperarMs: 60_000 },
  '4': { frase: 'limite de chamadas do aplicativo atingido', permanente: false, esperarMs: 60_000 },
  '131000': { frase: 'erro temporário da Meta', permanente: false },
  '131016': { frase: 'o serviço da Meta está indisponível no momento', permanente: false, esperarMs: 30_000 },
  '133015': { frase: 'o número está em manutenção na Meta', permanente: false, esperarMs: 60_000 },

  // ── Para tudo: o problema é o NÚMERO, e insistir piora ──
  '131048': {
    frase: 'a Meta limitou este número por suspeita de spam — PARE de disparar e revise a lista',
    permanente: false,
    derrubaConexao: true,
    esperarMs: 300_000,
  },
  '368': {
    frase: 'este número foi bloqueado temporariamente por violação de política',
    permanente: false,
    derrubaConexao: true,
    esperarMs: 300_000,
  },
  '133010': { frase: 'este número não está registrado na Cloud API', permanente: true, derrubaConexao: true },
  '190': { frase: 'o META_ACCESS_TOKEN expirou ou foi revogado', permanente: true, derrubaConexao: true },
  '200': { frase: 'o token não tem permissão para este número', permanente: true, derrubaConexao: true },
};

/** Monta o CloudError a partir do corpo de erro da Graph API. */
function erroDaMeta(corpo: unknown, status: number, retryAfterMs: number): CloudError {
  const erro = (corpo as { error?: Record<string, unknown> } | null)?.error ?? {};
  const codigo = erro.code === undefined ? null : String(erro.code);
  const subcodigo = erro.error_subcode === undefined ? null : String(erro.error_subcode);
  const detalhe =
    (erro.error_data as { details?: string } | undefined)?.details ??
    (typeof erro.error_user_msg === 'string' ? erro.error_user_msg : null) ??
    (typeof erro.message === 'string' ? erro.message : null) ??
    'sem detalhe';

  const classe = (codigo && CODIGOS[codigo]) || (subcodigo && CODIGOS[subcodigo]) || null;

  if (classe) {
    return new CloudError(`${classe.frase} (Meta ${codigo}: ${String(detalhe).slice(0, 200)})`, {
      status,
      codigo,
      permanente: classe.permanente,
      derrubaConexao: classe.derrubaConexao,
      esperarMs: Math.max(retryAfterMs, classe.esperarMs ?? 0),
    });
  }

  // Código desconhecido: 4xx é pedido errado (não adianta repetir), 5xx e 429 passam.
  const permanente = status >= 400 && status < 500 && status !== 429;
  return new CloudError(`A Meta recusou (${status}/${codigo ?? '?'}): ${String(detalhe).slice(0, 200)}`, {
    status,
    codigo,
    permanente,
    esperarMs: retryAfterMs,
  });
}

// ── A chamada ────────────────────────────────────────────────────────────────────

async function chamar<T = unknown>(
  caminho: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const { token, versao } = lerConfigCloud();
  const url = `https://graph.facebook.com/${versao}${caminho}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new CloudError(
      timeout
        ? `A Meta não respondeu em ${Math.round((init.timeoutMs ?? TIMEOUT_MS) / 1000)}s.`
        : 'Não foi possível falar com a Graph API da Meta.',
      { status: 0, permanente: false },
    );
  }

  const bruto = await res.text();
  let corpo: unknown = null;
  try {
    corpo = bruto ? JSON.parse(bruto) : null;
  } catch {
    corpo = bruto;
  }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 0);
    throw erroDaMeta(corpo, res.status, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
  }
  return corpo as T;
}

// ── Envio ────────────────────────────────────────────────────────────────────────

export type TipoCabecalho = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export interface EnvioTemplate {
  /** Telefone em E.164 sem `+`: 5511999999999. */
  para: string;
  template: string;
  idioma: string;
  /** Variáveis do corpo, NA ORDEM ({{1}}, {{2}}…), já resolvidas para esta pessoa. */
  variaveisCorpo?: string[];
  /** Variáveis do cabeçalho de texto, na ordem. */
  variaveisCabecalho?: string[];
  /** Tipo do cabeçalho do template, quando ele tem um. */
  tipoCabecalho?: TipoCabecalho | null;
  /** URL pública da mídia do cabeçalho (imagem, vídeo ou PDF). */
  midiaCabecalhoUrl?: string | null;
  /** Nome do arquivo mostrado quando o cabeçalho é DOCUMENT. */
  nomeArquivo?: string | null;
}

interface RespostaEnvio {
  messages?: { id?: string }[];
  contacts?: { wa_id?: string }[];
}

function parametrosDeTexto(valores: string[]) {
  return valores.map((v) => ({ type: 'text', text: String(v ?? '') }));
}

/** Monta o bloco `components` do template. Exportado para o teste conferir o formato. */
export function montarComponentes(envio: EnvioTemplate): Record<string, unknown>[] {
  const componentes: Record<string, unknown>[] = [];

  if (envio.tipoCabecalho === 'TEXT' && envio.variaveisCabecalho?.length) {
    componentes.push({ type: 'header', parameters: parametrosDeTexto(envio.variaveisCabecalho) });
  } else if (envio.tipoCabecalho && envio.tipoCabecalho !== 'TEXT' && envio.midiaCabecalhoUrl) {
    const chave = envio.tipoCabecalho.toLowerCase(); // image | video | document
    const midia: Record<string, unknown> = { link: envio.midiaCabecalhoUrl };
    // A Meta exige `filename` no documento, senão o anexo chega como "arquivo".
    if (chave === 'document') midia.filename = envio.nomeArquivo || 'documento.pdf';
    componentes.push({ type: 'header', parameters: [{ type: chave, [chave]: midia }] });
  }

  if (envio.variaveisCorpo?.length) {
    componentes.push({ type: 'body', parameters: parametrosDeTexto(envio.variaveisCorpo) });
  }

  return componentes;
}

/**
 * Manda um template. É este o caminho do disparo em massa: a primeira mensagem para
 * quem nunca escreveu não pode ser texto livre, e a Meta recusa (131047) se for.
 */
export async function enviarTemplate(
  phoneNumberId: string,
  envio: EnvioTemplate,
): Promise<{ messageId: string | null; waId: string | null }> {
  const componentes = montarComponentes(envio);
  const corpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: envio.para,
    type: 'template',
    template: {
      name: envio.template,
      language: { code: envio.idioma },
      ...(componentes.length ? { components: componentes } : {}),
    },
  };

  const res = await chamar<RespostaEnvio>(`/${phoneNumberId}/messages`, {
    method: 'POST',
    body: corpo,
  });
  return {
    messageId: res?.messages?.[0]?.id ?? null,
    waId: res?.contacts?.[0]?.wa_id ?? null,
  };
}

/**
 * Texto livre. Só vale DENTRO da janela de 24 h aberta por uma resposta da pessoa —
 * fora dela a Meta devolve 131047. Serve para a conversa individual, nunca para massa.
 */
export async function enviarTexto(
  phoneNumberId: string,
  envio: { para: string; texto: string; previewUrl?: boolean },
): Promise<{ messageId: string | null }> {
  const res = await chamar<RespostaEnvio>(`/${phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: envio.para,
      type: 'text',
      text: { body: envio.texto, preview_url: Boolean(envio.previewUrl) },
    },
  });
  return { messageId: res?.messages?.[0]?.id ?? null };
}

/** Marca como lida a mensagem que a pessoa mandou. Silencioso: falhar aqui não é grave. */
export async function marcarLida(phoneNumberId: string, messageId: string): Promise<void> {
  await chamar(`/${phoneNumberId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
  }).catch(() => undefined);
}

// ── Leitura: templates e saúde do número ─────────────────────────────────────────

export interface TemplateMeta {
  meta_id: string | null;
  nome: string;
  idioma: string;
  categoria: string;
  status: string;
  corpo: string;
  cabecalho_tipo: TipoCabecalho | null;
  cabecalho_texto: string | null;
  rodape: string | null;
  botoes: unknown[] | null;
  variaveis_corpo: number;
  variaveis_cabecalho: number;
}

/** Quantos `{{n}}` distintos existem no texto. É o que o compositor precisa preencher. */
export function contarVariaveis(texto: string): number {
  const achados = String(texto ?? '').match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  const posicoes = achados.map((m) => Number(m.replace(/\D/g, '')));
  return posicoes.length ? Math.max(...posicoes) : 0;
}

interface ComponenteMeta {
  type?: string;
  format?: string;
  text?: string;
  buttons?: unknown[];
}

/** Traduz um template cru da Meta para a nossa linha. Exportado para teste. */
export function normalizarTemplate(bruto: Record<string, unknown>): TemplateMeta {
  const componentes = (bruto.components as ComponenteMeta[] | undefined) ?? [];
  const cabecalho = componentes.find((c) => c.type?.toUpperCase() === 'HEADER');
  const corpo = componentes.find((c) => c.type?.toUpperCase() === 'BODY');
  const rodape = componentes.find((c) => c.type?.toUpperCase() === 'FOOTER');
  const botoes = componentes.find((c) => c.type?.toUpperCase() === 'BUTTONS');

  const formato = (cabecalho?.format ?? '').toUpperCase();
  const cabecalhoTipo = ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(formato)
    ? (formato as TipoCabecalho)
    : null;

  return {
    meta_id: bruto.id ? String(bruto.id) : null,
    nome: String(bruto.name ?? ''),
    idioma: String(bruto.language ?? 'pt_BR'),
    categoria: String(bruto.category ?? 'MARKETING').toUpperCase(),
    status: String(bruto.status ?? 'PENDING').toUpperCase(),
    corpo: corpo?.text ?? '',
    cabecalho_tipo: cabecalhoTipo,
    cabecalho_texto: cabecalhoTipo === 'TEXT' ? (cabecalho?.text ?? null) : null,
    rodape: rodape?.text ?? null,
    botoes: (botoes?.buttons as unknown[] | undefined) ?? null,
    variaveis_corpo: contarVariaveis(corpo?.text ?? ''),
    variaveis_cabecalho: cabecalhoTipo === 'TEXT' ? contarVariaveis(cabecalho?.text ?? '') : 0,
  };
}

/** Lista TODOS os templates da conta, seguindo a paginação da Graph API. */
export async function listarTemplates(wabaId: string): Promise<TemplateMeta[]> {
  const campos = 'id,name,status,category,language,components';
  let caminho: string | null = `/${wabaId}/message_templates?limit=100&fields=${campos}`;
  const achados: TemplateMeta[] = [];

  // Teto de 20 páginas (2 mil templates). Nenhuma conta real chega perto, e um cursor
  // que volta para si mesmo não pode travar o servidor num laço infinito.
  for (let pagina = 0; pagina < 20 && caminho; pagina += 1) {
    const res: { data?: Record<string, unknown>[]; paging?: { next?: string } } = await chamar(caminho);
    for (const bruto of res?.data ?? []) achados.push(normalizarTemplate(bruto));

    const proxima = res?.paging?.next ?? null;
    // O `next` vem como URL absoluta; aqui só o caminho interessa.
    caminho = proxima ? proxima.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+/, '') : null;
  }
  return achados;
}

export interface SaudeDoNumero {
  numero: string | null;
  nome: string | null;
  qualidade: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
  /** Teto de conversas iniciadas em 24 h, como a Meta devolve ("TIER_1K"). */
  limite: string | null;
}

/**
 * Estado do número na Meta. A `qualidade` é o termômetro que antecede a punição:
 * quando cai para RED, o teto diário despenca e o número entra na fila de revisão.
 */
export async function lerSaudeDoNumero(phoneNumberId: string): Promise<SaudeDoNumero> {
  const res = await chamar<Record<string, unknown>>(
    `/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
  );
  const qualidade = String(res?.quality_rating ?? 'UNKNOWN').toUpperCase();
  return {
    numero: res?.display_phone_number ? String(res.display_phone_number).replace(/\D/g, '') : null,
    nome: res?.verified_name ? String(res.verified_name) : null,
    qualidade: ['GREEN', 'YELLOW', 'RED'].includes(qualidade)
      ? (qualidade as 'GREEN' | 'YELLOW' | 'RED')
      : 'UNKNOWN',
    limite: res?.messaging_limit_tier ? String(res.messaging_limit_tier) : null,
  };
}
