// Cliente da Evolution API (v2) — o conector que substituiu o Z-API.
//
// O que mudou de conceito, e não só de fornecedor: no Z-API o token vivia numa
// credencial do n8n e valia para UM número. Aqui cada número é uma *instância* na
// Evolution, criada e conectada pelo próprio painel, e a chave (EVOLUTION_API_KEY) é
// a chave global do servidor — fica em variável de ambiente, nunca no banco e nunca
// no navegador. Todo acesso à Evolution passa por este arquivo, do lado do servidor.
//
// Versão alvo: Evolution API v2.x (a v1 usa outro formato de corpo em /message/*).

import { ehGrupo, normalizarDestino } from './jid';

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
}

/** Erro previsto do conector: já vem com mensagem em português para a tela. */
export class EvolutionError extends Error {
  readonly status: number;
  /** Erro definitivo (número inválido, instância inexistente): repetir não adianta. */
  readonly permanente: boolean;
  constructor(mensagem: string, status = 0, permanente = false) {
    super(mensagem);
    this.name = 'EvolutionError';
    this.status = status;
    this.permanente = permanente;
  }
}

/** Lê a configuração do ambiente. Lança quando falta — o chamador vira isso num 503. */
export function lerConfig(): EvolutionConfig {
  const baseUrl = (process.env.EVOLUTION_API_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.EVOLUTION_API_KEY ?? '').trim();
  if (!baseUrl || !apiKey) {
    throw new EvolutionError(
      'Evolution API não configurada. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY nas variáveis de ambiente.',
      503,
      true,
    );
  }
  return { baseUrl, apiKey };
}

/** Dá para falar com a Evolution? Usado pela UI para explicar o que falta configurar. */
export function evolutionConfigurada(): boolean {
  return Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY);
}

const TIMEOUT_MS = 20_000;

async function chamar<T = unknown>(
  caminho: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const { baseUrl, apiKey } = lerConfig();
  const url = `${baseUrl}${caminho}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new EvolutionError(
      timeout
        ? `A Evolution não respondeu em ${Math.round((init.timeoutMs ?? TIMEOUT_MS) / 1000)}s.`
        : `Não foi possível falar com a Evolution (${baseUrl}). Servidor fora do ar ou URL errada.`,
      0,
      false,
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
    // 4xx é culpa do pedido (não adianta repetir); 5xx e 429 podem melhorar sozinhos.
    const permanente = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw new EvolutionError(mensagemDeErro(corpo, res.status), res.status, permanente);
  }
  return corpo as T;
}

/** Cava a mensagem de erro da Evolution, que vem em um de vários formatos. */
function mensagemDeErro(corpo: unknown, status: number): string {
  if (typeof corpo === 'string' && corpo.trim()) return `${status}: ${corpo.slice(0, 300)}`;
  if (corpo && typeof corpo === 'object') {
    const c = corpo as Record<string, unknown>;
    const resposta = c.response as Record<string, unknown> | undefined;
    const bruto =
      (resposta?.message as unknown) ?? c.message ?? c.error ?? c.errors ?? c.detail;
    if (Array.isArray(bruto)) return `${status}: ${bruto.map(String).join('; ').slice(0, 300)}`;
    if (typeof bruto === 'string' && bruto.trim()) return `${status}: ${bruto.slice(0, 300)}`;
    if (bruto) return `${status}: ${JSON.stringify(bruto).slice(0, 300)}`;
  }
  return `A Evolution respondeu ${status} sem detalhar o motivo.`;
}

// ── Instâncias (um número conectado = uma instância) ──────────────────────────────

export type EstadoInstancia = 'conectada' | 'conectando' | 'desconectada';

export interface QrCode {
  /** PNG em data-URI, pronto para ir num <img src>. */
  base64: string | null;
  /** O mesmo QR em texto, para quem preferir gerar a imagem por fora. */
  codigo: string | null;
  /** Código de pareamento por número, quando a Evolution devolve. */
  pairingCode: string | null;
}

function lerQr(corpo: unknown): QrCode {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const qr = (c.qrcode ?? c.qr ?? c) as Record<string, unknown>;
  const base64 = typeof qr.base64 === 'string' ? qr.base64 : null;
  return {
    // A Evolution às vezes manda o base64 pelado, sem o prefixo de data-URI.
    base64: base64 && !base64.startsWith('data:') ? `data:image/png;base64,${base64}` : base64,
    codigo: typeof qr.code === 'string' ? qr.code : null,
    pairingCode: typeof qr.pairingCode === 'string' ? qr.pairingCode : null,
  };
}

/**
 * Cria a instância e já devolve o primeiro QR Code.
 * `webhookUrl` é registrado na criação — é por ele que chegam os ACKs de entrega e
 * leitura, então uma instância sem webhook nasce com os KPIs mudos.
 */
export async function criarInstancia(
  instanceName: string,
  webhookUrl?: string,
): Promise<QrCode> {
  const corpo = await chamar('/instance/create', {
    method: 'POST',
    body: {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      ...(webhookUrl
        ? {
            webhook: {
              url: webhookUrl,
              enabled: true,
              byEvents: false,
              base64: false,
              events: EVENTOS_WEBHOOK,
            },
          }
        : {}),
    },
    timeoutMs: 40_000,
  });
  return lerQr(corpo);
}

/** Eventos que o sistema realmente consome. Assinar menos = menos ruído no servidor. */
export const EVENTOS_WEBHOOK = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
] as const;

/** Pede um QR novo para uma instância que já existe (o QR expira em ~40s). */
export async function conectarInstancia(instanceName: string): Promise<QrCode> {
  const corpo = await chamar(`/instance/connect/${encodeURIComponent(instanceName)}`, {
    timeoutMs: 40_000,
  });
  return lerQr(corpo);
}

export async function estadoInstancia(instanceName: string): Promise<EstadoInstancia> {
  const corpo = await chamar<Record<string, unknown>>(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  );
  const inst = (corpo?.instance ?? corpo ?? {}) as Record<string, unknown>;
  const estado = String(inst.state ?? '').toLowerCase();
  if (estado === 'open') return 'conectada';
  if (estado === 'connecting') return 'conectando';
  return 'desconectada';
}

export interface InfoInstancia {
  estado: EstadoInstancia;
  numero: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
}

/** Quem está do outro lado: número, nome e foto do perfil conectado. */
export async function infoInstancia(instanceName: string): Promise<InfoInstancia> {
  const corpo = await chamar<unknown>(
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
  );
  // Dependendo da versão vem um array ou um objeto; e os campos podem estar aninhados
  // em `instance`. Achatar aqui evita espalhar `?.` por toda a aplicação.
  const primeiro = Array.isArray(corpo) ? corpo[0] : corpo;
  const raiz = (primeiro ?? {}) as Record<string, unknown>;
  const inst = ((raiz.instance ?? raiz) ?? {}) as Record<string, unknown>;

  const estadoBruto = String(inst.connectionStatus ?? inst.status ?? inst.state ?? '').toLowerCase();
  const estado: EstadoInstancia =
    estadoBruto === 'open' ? 'conectada' : estadoBruto === 'connecting' ? 'conectando' : 'desconectada';

  const donoBruto = String(inst.owner ?? inst.ownerJid ?? inst.number ?? '');
  const numero = donoBruto ? donoBruto.split('@')[0].split(':')[0].replace(/\D/g, '') : null;

  return {
    estado,
    numero: numero || null,
    profileName: (inst.profileName ?? inst.name ?? null) as string | null,
    profilePicUrl: (inst.profilePicUrl ?? inst.profilePictureUrl ?? null) as string | null,
  };
}

/** Desconecta o número (a instância continua existindo e pode reconectar por QR). */
export async function desconectarInstancia(instanceName: string): Promise<void> {
  await chamar(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: 'DELETE' });
}

/** Apaga a instância na Evolution. Irreversível do lado de lá. */
export async function apagarInstancia(instanceName: string): Promise<void> {
  await chamar(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: 'DELETE' });
}

/** (Re)aponta o webhook da instância. Usado quando a URL pública do app muda. */
export async function definirWebhook(instanceName: string, url: string): Promise<void> {
  await chamar(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      webhook: {
        enabled: true,
        url,
        byEvents: false,
        base64: false,
        events: EVENTOS_WEBHOOK,
      },
    },
  });
}

// ── Grupos ───────────────────────────────────────────────────────────────────────

export interface GrupoEvolution {
  groupId: string;
  nome: string;
  participantes: number | null;
  fotoUrl: string | null;
}

/**
 * Lista os grupos de que o número participa — o fim do "cole o ID do grupo na mão".
 * `getParticipants=false` porque só precisamos da contagem, e puxar a lista completa
 * de participantes de dezenas de grupos estoura o tempo da requisição.
 */
export async function listarGrupos(instanceName: string): Promise<GrupoEvolution[]> {
  const corpo = await chamar<unknown>(
    `/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
    { timeoutMs: 60_000 },
  );
  const lista = Array.isArray(corpo)
    ? corpo
    : Array.isArray((corpo as Record<string, unknown>)?.groups)
      ? ((corpo as Record<string, unknown>).groups as unknown[])
      : [];

  return lista
    .map((bruto) => {
      const g = (bruto ?? {}) as Record<string, unknown>;
      const groupId = String(g.id ?? g.jid ?? '').trim();
      if (!groupId) return null;
      const tamanho = g.size ?? g.participantsCount ?? g.subjectOwnerCount;
      return {
        groupId,
        nome: String(g.subject ?? g.name ?? 'Grupo sem nome').trim() || 'Grupo sem nome',
        participantes: typeof tamanho === 'number' ? tamanho : null,
        fotoUrl: (g.pictureUrl ?? g.profilePicUrl ?? null) as string | null,
      };
    })
    .filter((g): g is GrupoEvolution => g !== null);
}

// ── Envio ────────────────────────────────────────────────────────────────────────

export type TipoMensagem = 'texto' | 'imagem' | 'video' | 'pdf' | 'audio' | 'enquete';

export interface Envio {
  destino: string;
  tipo: TipoMensagem;
  texto: string;
  midiaUrl?: string | null;
  /** Só tem efeito em grupo — em conversa individual o WhatsApp ignora. */
  mencionarTodos?: boolean;
  /** Só para `tipo: 'enquete'`: a pergunta vai em `texto`. */
  enquete?: { opcoes: string[]; multipla: boolean };
}

const MIME_POR_EXTENSAO: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
};

/** Deduz o mimetype pela extensão da URL — a Evolution exige o campo em mídia. */
export function mimeDaUrl(url: string, tipo: TipoMensagem): string {
  const limpa = url.split('?')[0].split('#')[0];
  const ext = limpa.includes('.') ? (limpa.split('.').pop() ?? '').toLowerCase() : '';
  if (MIME_POR_EXTENSAO[ext]) return MIME_POR_EXTENSAO[ext];
  if (tipo === 'imagem') return 'image/jpeg';
  if (tipo === 'video') return 'video/mp4';
  if (tipo === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

/** Nome que aparece no card do documento no WhatsApp. */
export function nomeDoArquivo(url: string): string {
  const limpa = url.split('?')[0].split('#')[0];
  const base = limpa.split('/').pop() ?? '';
  return base || 'documento.pdf';
}

/**
 * Monta a rota e o corpo do envio. Separado do `fetch` de propósito: é a parte com
 * regra de negócio (qual endpoint, qual campo, menção a todos) e dá para testar sem rede.
 */
export function montarEnvio(
  instanceName: string,
  envio: Envio,
): { caminho: string; corpo: Record<string, unknown> } {
  const number = normalizarDestino(envio.destino);
  const instancia = encodeURIComponent(instanceName);
  // `mentionsEveryOne` é o @todos nativo da Evolution: ela mesma busca os participantes.
  // No Z-API isso exigia uma chamada extra de group-metadata e montar a lista à mão.
  const mencao =
    envio.mencionarTodos && ehGrupo(envio.destino) ? { mentionsEveryOne: true } : {};

  if (envio.tipo === 'enquete') {
    const opcoes = envio.enquete?.opcoes ?? [];
    return {
      caminho: `/message/sendPoll/${instancia}`,
      corpo: {
        number,
        name: envio.texto,
        // 1 = escolha única; o total de opções = "Permitir várias respostas".
        selectableCount: envio.enquete?.multipla ? opcoes.length : 1,
        values: opcoes,
        ...mencao,
      },
    };
  }

  if (envio.tipo === 'texto' || !envio.midiaUrl) {
    return {
      caminho: `/message/sendText/${instancia}`,
      corpo: { number, text: envio.texto, linkPreview: true, ...mencao },
    };
  }

  if (envio.tipo === 'audio') {
    return {
      caminho: `/message/sendWhatsAppAudio/${instancia}`,
      corpo: { number, audio: envio.midiaUrl, ...mencao },
    };
  }

  const mediatype =
    envio.tipo === 'imagem' ? 'image' : envio.tipo === 'video' ? 'video' : 'document';

  return {
    caminho: `/message/sendMedia/${instancia}`,
    corpo: {
      number,
      mediatype,
      mimetype: mimeDaUrl(envio.midiaUrl, envio.tipo),
      media: envio.midiaUrl,
      caption: envio.texto || undefined,
      ...(mediatype === 'document' ? { fileName: nomeDoArquivo(envio.midiaUrl) } : {}),
      ...mencao,
    },
  };
}

export interface ResultadoEnvio {
  messageId: string | null;
  /** O que a Evolution devolveu, guardado para depurar um envio específico. */
  bruto: unknown;
}

/** Envia uma mensagem. Lança `EvolutionError` — o worker decide repetir ou desistir. */
export async function enviarMensagem(
  instanceName: string,
  envio: Envio,
): Promise<ResultadoEnvio> {
  const destino = normalizarDestino(envio.destino);
  if (!destino) {
    throw new EvolutionError(`Destino inválido: "${envio.destino}".`, 400, true);
  }
  const { caminho, corpo } = montarEnvio(instanceName, envio);
  const resposta = await chamar<Record<string, unknown>>(caminho, {
    method: 'POST',
    body: corpo,
    timeoutMs: 45_000,
  });
  const key = (resposta?.key ?? {}) as Record<string, unknown>;
  return {
    messageId: typeof key.id === 'string' ? key.id : null,
    bruto: resposta,
  };
}

/** O número existe no WhatsApp? Evita queimar disparo em telefone que não tem conta. */
export async function verificarNumeros(
  instanceName: string,
  numeros: string[],
): Promise<Record<string, boolean>> {
  const corpo = await chamar<unknown>(
    `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body: { numbers: numeros.map((n) => normalizarDestino(n)) }, timeoutMs: 30_000 },
  );
  const lista = Array.isArray(corpo) ? corpo : [];
  const mapa: Record<string, boolean> = {};
  for (const bruto of lista) {
    const item = (bruto ?? {}) as Record<string, unknown>;
    const numero = String(item.number ?? '').replace(/\D/g, '');
    if (numero) mapa[numero] = item.exists === true;
  }
  return mapa;
}

// ── Conversas (a tela "Celular") ─────────────────────────────────────────────────
// Leitura do que está de fato no aparelho, e não do que o SendFlow acha que mandou.
// É a prova de envio: se a mensagem aparece aqui, ela está no WhatsApp.

/** Todas as conversas do número, como vêm da Evolution (a tradução mora em conversas.ts). */
export async function listarConversasBrutas(instanceName: string): Promise<unknown[]> {
  const corpo = await chamar<unknown>(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {},
    timeoutMs: 30_000,
  });
  return Array.isArray(corpo) ? corpo : [];
}

/** Uma página do histórico de uma conversa, da mais nova para a mais antiga. */
export async function listarMensagensBrutas(
  instanceName: string,
  jid: string,
  pagina = 1,
  porPagina = 40,
): Promise<{ registros: unknown[]; paginas: number }> {
  const corpo = await chamar<Record<string, unknown>>(
    `/chat/findMessages/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      body: { where: { key: { remoteJid: jid } }, page: pagina, offset: porPagina },
      timeoutMs: 30_000,
    },
  );
  const msgs = (corpo?.messages ?? {}) as Record<string, unknown>;
  return {
    registros: Array.isArray(msgs.records) ? msgs.records : [],
    paginas: Number(msgs.pages) || 1,
  };
}

/** Baixa a mídia de uma mensagem (a URL do WhatsApp é cifrada; só a Evolution abre). */
export async function baixarMidia(
  instanceName: string,
  messageId: string,
): Promise<{ base64: string; mimetype: string } | null> {
  const corpo = await chamar<Record<string, unknown>>(
    `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
    {
      method: 'POST',
      body: { message: { key: { id: messageId } }, convertToMp4: false },
      timeoutMs: 45_000,
    },
  );
  const base64 = typeof corpo?.base64 === 'string' ? corpo.base64 : null;
  if (!base64) return null;
  return { base64, mimetype: typeof corpo.mimetype === 'string' ? corpo.mimetype : 'application/octet-stream' };
}

/** Edita o texto de uma mensagem já enviada. O WhatsApp só aceita até 15 min depois. */
export async function editarMensagem(
  instanceName: string,
  jid: string,
  messageId: string,
  texto: string,
): Promise<void> {
  await chamar(`/chat/updateMessage/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: { number: jid, key: { id: messageId, remoteJid: jid, fromMe: true }, text: texto },
    timeoutMs: 30_000,
  });
}

/** "Apagar para todos". O WhatsApp aceita por cerca de 2 dias depois do envio. */
export async function apagarParaTodos(
  instanceName: string,
  jid: string,
  messageId: string,
): Promise<void> {
  await chamar(`/chat/deleteMessageForEveryone/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE',
    body: { id: messageId, remoteJid: jid, fromMe: true },
    timeoutMs: 30_000,
  });
}
