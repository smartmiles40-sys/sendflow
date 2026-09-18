// Tradução do histórico da Evolution (formato Baileys) para o que a tela "Celular"
// mostra. Separado do cliente HTTP para dar para testar sem rede — o formato das
// mensagens do WhatsApp tem dezenas de variações, e errar aqui é mostrar balão vazio.

export type TipoBalao =
  | 'texto'
  | 'imagem'
  | 'video'
  | 'audio'
  | 'documento'
  | 'figurinha'
  | 'enquete'
  | 'contato'
  | 'localizacao'
  | 'outro';

/** Situação de uma mensagem ENVIADA por nós, do jeito que o WhatsApp mostra nos tiques. */
export type Tique = 'pendente' | 'enviado' | 'entregue' | 'lido' | 'erro' | null;

export interface Balao {
  id: string;
  fromMe: boolean;
  tipo: TipoBalao;
  texto: string | null;
  /** Nome do arquivo (documento) — o resto da mídia é carregado sob demanda. */
  arquivo: string | null;
  /** Em grupo, quem mandou. */
  autor: string | null;
  /** Segundos desde 1970 (formato do WhatsApp). */
  ts: number;
  tique: Tique;
  editada: boolean;
}

export interface Conversa {
  jid: string;
  nome: string;
  grupo: boolean;
  foto: string | null;
  /** Telefone real quando a conversa está endereçada por @lid. */
  telefone: string | null;
  atualizadaEm: string | null;
  naoLidas: number;
  ultima: { texto: string; fromMe: boolean; ts: number } | null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Tipos que são "sistema" (troca de chave, apagar, editar): nunca viram balão. */
const INVISIVEIS = new Set([
  'protocolMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'reactionMessage',
  'pollUpdateMessage',
  'editedMessage',
  'keepInChatMessage',
]);

export function mensagemVisivel(messageType: unknown): boolean {
  return typeof messageType === 'string' && !INVISIVEIS.has(messageType);
}

/** Lê o conteúdo de uma mensagem do WhatsApp em qualquer um dos formatos comuns. */
export function lerConteudo(
  messageType: unknown,
  message: unknown,
): { tipo: TipoBalao; texto: string | null; arquivo: string | null } {
  const m = obj(message);
  const tipoBruto = String(messageType ?? '');

  const conversa = str(m.conversation);
  if (conversa) return { tipo: 'texto', texto: conversa, arquivo: null };
  const est = str(obj(m.extendedTextMessage).text);
  if (est) return { tipo: 'texto', texto: est, arquivo: null };

  const img = obj(m.imageMessage);
  if (m.imageMessage) return { tipo: 'imagem', texto: str(img.caption), arquivo: null };
  const vid = obj(m.videoMessage ?? m.ptvMessage);
  if (m.videoMessage || m.ptvMessage) return { tipo: 'video', texto: str(vid.caption), arquivo: null };
  if (m.audioMessage) return { tipo: 'audio', texto: null, arquivo: null };
  const doc = obj(m.documentMessage ?? obj(m.documentWithCaptionMessage).message);
  if (m.documentMessage || m.documentWithCaptionMessage) {
    const interno = obj(obj(obj(m.documentWithCaptionMessage).message).documentMessage);
    const d = Object.keys(interno).length ? interno : doc;
    return { tipo: 'documento', texto: str(d.caption), arquivo: str(d.fileName) ?? str(d.title) };
  }
  if (m.stickerMessage) return { tipo: 'figurinha', texto: null, arquivo: null };
  const enquete = obj(m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3);
  if (Object.keys(enquete).length) return { tipo: 'enquete', texto: str(enquete.name), arquivo: null };
  const contato = obj(m.contactMessage);
  if (m.contactMessage) return { tipo: 'contato', texto: str(contato.displayName), arquivo: null };
  if (m.locationMessage || m.liveLocationMessage) return { tipo: 'localizacao', texto: null, arquivo: null };

  // Tipo conhecido pelo nome mas com o corpo vazio (acontece com mídia antiga).
  if (tipoBruto === 'imageMessage') return { tipo: 'imagem', texto: null, arquivo: null };
  if (tipoBruto === 'videoMessage' || tipoBruto === 'ptvMessage') return { tipo: 'video', texto: null, arquivo: null };
  if (tipoBruto === 'audioMessage') return { tipo: 'audio', texto: null, arquivo: null };
  return { tipo: 'outro', texto: null, arquivo: null };
}

const ROTULO: Record<TipoBalao, string> = {
  texto: '',
  imagem: '📷 Foto',
  video: '🎬 Vídeo',
  audio: '🎤 Áudio',
  documento: '📄 Documento',
  figurinha: '💟 Figurinha',
  enquete: '📊 Enquete',
  contato: '👤 Contato',
  localizacao: '📍 Localização',
  outro: 'Mensagem',
};

/** Uma linha de prévia, para a lista de conversas. */
export function previa(tipo: TipoBalao, texto: string | null): string {
  if (tipo === 'texto') return texto ?? '';
  return texto ? `${ROTULO[tipo]} · ${texto}` : ROTULO[tipo];
}

/** Status do Baileys (texto ou número) → tique. */
export function lerTique(v: unknown): Tique {
  if (typeof v === 'number') {
    return v === 0 ? 'erro' : v === 1 ? 'pendente' : v === 2 ? 'enviado' : v === 3 ? 'entregue' : v >= 4 ? 'lido' : null;
  }
  const s = String(v ?? '').toUpperCase();
  if (s === 'ERROR') return 'erro';
  if (s === 'PENDING') return 'pendente';
  if (s === 'SERVER_ACK') return 'enviado';
  if (s === 'DELIVERY_ACK') return 'entregue';
  if (s === 'READ' || s === 'PLAYED') return 'lido';
  return null;
}

const ORDEM_TIQUE: Record<string, number> = { erro: 0, pendente: 1, enviado: 2, entregue: 3, lido: 4 };

/** O tique mais avançado entre o status do registro e as atualizações que chegaram depois. */
export function melhorTique(...valores: unknown[]): Tique {
  let melhor: Tique = null;
  for (const v of valores) {
    const t = lerTique(v);
    if (t && (melhor === null || ORDEM_TIQUE[t] > ORDEM_TIQUE[melhor])) melhor = t;
  }
  return melhor;
}

/** Um registro de `chat/findMessages` → balão. Nulo quando não é para mostrar. */
export function paraBalao(registro: unknown): Balao | null {
  const r = obj(registro);
  if (!mensagemVisivel(r.messageType)) return null;
  const key = obj(r.key);
  const id = str(key.id);
  if (!id) return null;
  const fromMe = key.fromMe === true;
  const { tipo, texto, arquivo } = lerConteudo(r.messageType, r.message);
  const updates = Array.isArray(r.MessageUpdate) ? (r.MessageUpdate as unknown[]) : [];
  const tique = fromMe ? melhorTique(r.status, ...updates.map((u) => obj(u).status)) : null;
  const ts = Number(r.messageTimestamp);
  return {
    id,
    fromMe,
    tipo,
    texto,
    arquivo,
    autor: fromMe ? null : str(r.pushName),
    ts: Number.isFinite(ts) ? ts : 0,
    // Se o WhatsApp mandou um "o texto agora é X", o registro já vem com o texto novo.
    tique: tique ?? (fromMe ? 'enviado' : null),
    editada: Boolean(obj(obj(r.message).editedMessage).message) || Boolean(r.editedAt),
  };
}

/** Um registro de `chat/findChats` → conversa da lista. */
export function paraConversa(registro: unknown, nomesDeGrupo: Map<string, string>): Conversa | null {
  const r = obj(registro);
  const jid = str(r.remoteJid);
  if (!jid || jid === 'status@broadcast') return null;
  const grupo = jid.endsWith('@g.us');
  const ultimaBruta = obj(r.lastMessage);
  const chave = obj(ultimaBruta.key);
  const alt = str(chave.remoteJidAlt);
  const telefone = alt ? alt.split('@')[0] : jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : null;

  let ultima: Conversa['ultima'] = null;
  if (Object.keys(ultimaBruta).length && mensagemVisivel(ultimaBruta.messageType)) {
    const c = lerConteudo(ultimaBruta.messageType, ultimaBruta.message);
    ultima = {
      texto: previa(c.tipo, c.texto),
      fromMe: chave.fromMe === true,
      ts: Number(ultimaBruta.messageTimestamp) || 0,
    };
  }

  // Em grupo, o pushName do chat é de quem mandou a última mensagem, não o nome do grupo.
  const nome =
    (grupo ? nomesDeGrupo.get(jid) : null) ??
    (grupo ? str(r.name) ?? str(r.subject) : str(r.pushName) ?? str(r.name)) ??
    (telefone ? `+${telefone}` : grupo ? 'Grupo' : jid.split('@')[0]);

  return {
    jid,
    nome,
    grupo,
    foto: str(r.profilePicUrl),
    telefone,
    atualizadaEm: str(r.updatedAt),
    naoLidas: Number(r.unreadCount) || 0,
    ultima,
  };
}

/** WhatsApp só deixa editar por 15 minutos depois do envio. */
export const JANELA_EDICAO_SEG = 15 * 60;

export function podeEditar(b: Pick<Balao, 'fromMe' | 'tipo' | 'ts'>, agoraSeg: number): boolean {
  return b.fromMe && b.tipo === 'texto' && agoraSeg - b.ts < JANELA_EDICAO_SEG;
}
