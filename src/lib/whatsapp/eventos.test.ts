import { describe, it, expect } from 'vitest';
import { lerAck, parseEventoEvolution } from './eventos';

/**
 * Este arquivo é o teste mais importante do projeto para os KPIs.
 *
 * Se o parser deixar de entender o formato que a Evolution manda, "entregue" e "lido"
 * ficam em zero — e nada quebra visivelmente: a campanha diz "enviada" e o painel diz
 * 0% de leitura, que é indistinguível de "ninguém leu". Por isso cada variação de
 * payload já vista em produção tem um caso aqui.
 */

describe('lerAck', () => {
  it('entende o formato textual da Evolution v2', () => {
    expect(lerAck('DELIVERY_ACK')).toBe('entregue');
    expect(lerAck('READ')).toBe('lido');
    expect(lerAck('SERVER_ACK')).toBe('enviado');
  });
  it('entende o formato numérico do Baileys', () => {
    expect(lerAck(2)).toBe('enviado');
    expect(lerAck(3)).toBe('entregue');
    expect(lerAck(4)).toBe('lido');
  });
  it('entende o número dentro de uma string', () => {
    expect(lerAck('4')).toBe('lido');
  });
  it('PLAYED (áudio ouvido) conta como lido — a mensagem foi consumida', () => {
    expect(lerAck('PLAYED')).toBe('lido');
    expect(lerAck(5)).toBe('lido');
  });
  it('PENDING e ERROR não são ACK relevante', () => {
    expect(lerAck('PENDING')).toBeNull();
    expect(lerAck(1)).toBeNull();
    expect(lerAck(0)).toBeNull();
  });
  it('não quebra com valor inesperado', () => {
    expect(lerAck(null)).toBeNull();
    expect(lerAck({})).toBeNull();
    expect(lerAck('QUALQUER_COISA')).toBeNull();
  });
});

describe('parseEventoEvolution — ACK de entrega e leitura', () => {
  it('formato A: data.status textual com keyId', () => {
    const e = parseEventoEvolution({
      event: 'messages.update',
      instance: 'comercial-1',
      data: { keyId: '3EB0ABC', remoteJid: '120363@g.us', status: 'DELIVERY_ACK' },
    });
    expect(e).toEqual({ tipo: 'ack', messageId: '3EB0ABC', status: 'entregue', remoteJid: '120363@g.us' });
  });

  it('formato B: Baileys cru, com data.update.status numérico e data.key.id', () => {
    const e = parseEventoEvolution({
      event: 'messages.update',
      data: { key: { id: '3EB0XYZ', remoteJid: '5511999998888@s.whatsapp.net' }, update: { status: 4 } },
    });
    expect(e).toMatchObject({ tipo: 'ack', messageId: '3EB0XYZ', status: 'lido' });
  });

  it('formato C: híbrido, status numérico direto em data', () => {
    const e = parseEventoEvolution({
      event: 'MESSAGES_UPDATE',
      data: { messageId: '3EB0HIB', status: 3 },
    });
    expect(e).toMatchObject({ tipo: 'ack', messageId: '3EB0HIB', status: 'entregue' });
  });

  it('aceita o nome do evento em maiúsculas com underscore', () => {
    const e = parseEventoEvolution({
      event: 'MESSAGES_UPDATE',
      data: { keyId: 'X', status: 'READ' },
    });
    expect(e.tipo).toBe('ack');
  });

  it('update sem id de mensagem é ignorado, não quebra', () => {
    expect(parseEventoEvolution({ event: 'messages.update', data: { status: 'READ' } })).toMatchObject({
      tipo: 'ignorado',
    });
  });

  it('update sem ACK relevante é ignorado', () => {
    expect(
      parseEventoEvolution({ event: 'messages.update', data: { keyId: 'X', status: 'PENDING' } }),
    ).toMatchObject({ tipo: 'ignorado' });
  });
});

describe('parseEventoEvolution — resposta recebida', () => {
  it('lê o texto e o remetente de uma mensagem que chegou', () => {
    const e = parseEventoEvolution({
      event: 'messages.upsert',
      data: {
        key: { id: 'ABC', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
        message: { conversation: 'quero sim!' },
        pushName: 'Maria',
      },
    });
    expect(e).toMatchObject({
      tipo: 'resposta',
      remoteJid: '5511999998888@s.whatsapp.net',
      texto: 'quero sim!',
      nome: 'Maria',
    });
  });

  it('a NOSSA própria mensagem nunca é contada como resposta', () => {
    const e = parseEventoEvolution({
      event: 'messages.upsert',
      data: { key: { id: 'ABC', remoteJid: '5511999998888@s.whatsapp.net', fromMe: true } },
    });
    expect(e).toMatchObject({ tipo: 'ignorado' });
  });

  it('lê texto de mensagem estendida (a que tem link)', () => {
    const e = parseEventoEvolution({
      event: 'messages.upsert',
      data: {
        key: { id: 'A', remoteJid: 'x@s.whatsapp.net' },
        message: { extendedTextMessage: { text: 'olha esse link' } },
      },
    });
    expect(e).toMatchObject({ tipo: 'resposta', texto: 'olha esse link' });
  });

  it('lê a legenda de uma imagem respondida', () => {
    const e = parseEventoEvolution({
      event: 'messages.upsert',
      data: {
        key: { id: 'A', remoteJid: 'x@s.whatsapp.net' },
        message: { imageMessage: { caption: 'foto do comprovante' } },
      },
    });
    expect(e).toMatchObject({ tipo: 'resposta', texto: 'foto do comprovante' });
  });

  it('áudio vira uma resposta com marcador, não texto nulo', () => {
    const e = parseEventoEvolution({
      event: 'messages.upsert',
      data: { key: { id: 'A', remoteJid: 'x@s.whatsapp.net' }, message: { audioMessage: {} } },
    });
    expect(e).toMatchObject({ tipo: 'resposta', texto: '[áudio]' });
  });
});

describe('parseEventoEvolution — conexão e QR', () => {
  it('open = conectada', () => {
    expect(parseEventoEvolution({ event: 'connection.update', data: { state: 'open' } })).toEqual({
      tipo: 'conexao',
      estado: 'conectada',
    });
  });
  it('close = desconectada', () => {
    expect(parseEventoEvolution({ event: 'connection.update', data: { state: 'close' } })).toEqual({
      tipo: 'conexao',
      estado: 'desconectada',
    });
  });
  it('connecting = conectando', () => {
    expect(parseEventoEvolution({ event: 'connection.update', data: { state: 'connecting' } })).toEqual({
      tipo: 'conexao',
      estado: 'conectando',
    });
  });
  it('lê o QR novo', () => {
    const e = parseEventoEvolution({
      event: 'qrcode.updated',
      data: { qrcode: { base64: 'data:image/png;base64,AAA' } },
    });
    expect(e).toEqual({ tipo: 'qrcode', base64: 'data:image/png;base64,AAA' });
  });
});

describe('parseEventoEvolution — robustez', () => {
  // O endpoint de webhook NUNCA pode lançar: a Evolution reenvia o que falha, e um
  // erro aqui vira uma fila de retentativas em cima do servidor.
  it('não lança com payload nulo, vazio ou de outro formato', () => {
    expect(() => parseEventoEvolution(null)).not.toThrow();
    expect(() => parseEventoEvolution({})).not.toThrow();
    expect(() => parseEventoEvolution('texto solto')).not.toThrow();
    expect(() => parseEventoEvolution({ event: 'chats.upsert', data: [] })).not.toThrow();
    expect(parseEventoEvolution({}).tipo).toBe('ignorado');
  });
});
