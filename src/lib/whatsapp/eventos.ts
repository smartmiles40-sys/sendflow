// Tradução dos webhooks da Evolution para o vocabulário do sistema.
//
// Este arquivo é a razão de existir o KPI de leitura: sem interpretar o ACK que o
// WhatsApp devolve, "entregue" e "lido" nunca sairiam de zero.
//
// Por que tanta tolerância a formato: a Evolution muda a forma do payload entre
// versões, e o que chega depende também da versão do Baileys por baixo. Já vimos as
// três formas abaixo em produção, e o custo de errar é um KPI mudo que ninguém
// percebe estar quebrado. Então o parser aceita todas e é um dos poucos lugares do
// projeto com teste cobrindo cada variação.
//
//   A) data.status = "DELIVERY_ACK"            (Evolution v2, o mais comum)
//   B) data.update.status = 3                  (Baileys cru, numérico)
//   C) data.status = 3                         (híbrido)

/** Estados de ACK que nos interessam, na ordem do funil. */
export type AckStatus = 'enviado' | 'entregue' | 'lido';

export type EventoWhatsApp =
  | { tipo: 'ack'; messageId: string; status: AckStatus; remoteJid: string | null }
  | { tipo: 'resposta'; remoteJid: string; messageId: string | null; texto: string | null; nome: string | null }
  | { tipo: 'conexao'; estado: 'conectada' | 'conectando' | 'desconectada' }
  | { tipo: 'qrcode'; base64: string | null }
  | { tipo: 'ignorado'; motivo: string };

// Baileys: 0 ERROR · 1 PENDING · 2 SERVER_ACK · 3 DELIVERY_ACK · 4 READ · 5 PLAYED.
// PLAYED (áudio ouvido) entra como 'lido': do ponto de vista do KPI, consumiu a mensagem.
const ACK_NUMERICO: Record<number, AckStatus | null> = {
  0: null,
  1: null,
  2: 'enviado',
  3: 'entregue',
  4: 'lido',
  5: 'lido',
};

const ACK_TEXTO: Record<string, AckStatus | null> = {
  ERROR: null,
  PENDING: null,
  SERVER_ACK: 'enviado',
  DELIVERY_ACK: 'entregue',
  READ: 'lido',
  PLAYED: 'lido',
};

/** Interpreta o campo de status em qualquer uma das formas conhecidas. */
export function lerAck(valor: unknown): AckStatus | null {
  if (typeof valor === 'number') return ACK_NUMERICO[valor] ?? null;
  if (typeof valor === 'string') {
    const v = valor.trim().toUpperCase();
    if (v in ACK_TEXTO) return ACK_TEXTO[v];
    // Alguns builds mandam o número dentro de uma string.
    const n = Number(v);
    return Number.isInteger(n) ? (ACK_NUMERICO[n] ?? null) : null;
  }
  return null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Extrai o corpo legível de uma mensagem recebida, entre os vários tipos do WhatsApp. */
function extrairTexto(message: Record<string, unknown>): string | null {
  const conversa = texto(message.conversation);
  if (conversa) return conversa;
  const estendida = obj(message.extendedTextMessage);
  const est = texto(estendida.text);
  if (est) return est;
  for (const chave of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const legenda = texto(obj(message[chave]).caption);
    if (legenda) return legenda;
  }
  if (message.audioMessage) return '[áudio]';
  if (message.stickerMessage) return '[figurinha]';
  return null;
}

/**
 * Traduz um webhook da Evolution para um evento do sistema.
 * Nunca lança: payload estranho vira `{ tipo: 'ignorado' }` com o motivo, porque
 * derrubar o endpoint de webhook faz a Evolution ficar reenviando em loop.
 */
export function parseEventoEvolution(payload: unknown): EventoWhatsApp {
  const p = obj(payload);
  const evento = String(p.event ?? p.type ?? '').toLowerCase().replace(/_/g, '.');
  const data = obj(p.data);

  if (evento === 'messages.update' || evento === 'message.update' || evento === 'messages.ack') {
    const update = obj(data.update);
    const status = lerAck(data.status ?? update.status);
    const key = obj(data.key);
    const messageId =
      texto(data.keyId) ?? texto(key.id) ?? texto(data.messageId) ?? texto(data.id);
    if (!messageId) return { tipo: 'ignorado', motivo: 'update sem id de mensagem' };
    if (!status) return { tipo: 'ignorado', motivo: 'update sem ACK relevante' };
    return {
      tipo: 'ack',
      messageId,
      status,
      remoteJid: texto(data.remoteJid) ?? texto(key.remoteJid),
    };
  }

  if (evento === 'messages.upsert' || evento === 'message.upsert') {
    const key = obj(data.key);
    // `fromMe` é o filtro que impede contar a nossa própria mensagem como resposta.
    if (key.fromMe === true || data.fromMe === true) {
      return { tipo: 'ignorado', motivo: 'eco da própria mensagem' };
    }
    const remoteJid = texto(data.remoteJid) ?? texto(key.remoteJid);
    if (!remoteJid) return { tipo: 'ignorado', motivo: 'upsert sem remetente' };
    return {
      tipo: 'resposta',
      remoteJid,
      messageId: texto(key.id) ?? texto(data.keyId),
      texto: extrairTexto(obj(data.message)),
      nome: texto(data.pushName),
    };
  }

  if (evento === 'connection.update') {
    const estado = String(data.state ?? data.connection ?? '').toLowerCase();
    if (estado === 'open') return { tipo: 'conexao', estado: 'conectada' };
    if (estado === 'connecting') return { tipo: 'conexao', estado: 'conectando' };
    if (estado === 'close') return { tipo: 'conexao', estado: 'desconectada' };
    return { tipo: 'ignorado', motivo: `estado de conexão desconhecido: ${estado}` };
  }

  if (evento === 'qrcode.updated') {
    const qr = obj(data.qrcode);
    return { tipo: 'qrcode', base64: texto(qr.base64) ?? texto(data.base64) };
  }

  return { tipo: 'ignorado', motivo: `evento não tratado: ${evento || '(vazio)'}` };
}
