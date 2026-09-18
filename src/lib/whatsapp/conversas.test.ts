import { describe, it, expect } from 'vitest';
import { lerConteudo, melhorTique, paraBalao, paraConversa, podeEditar, previa } from './conversas';

// Formatos copiados de respostas reais da Evolution 2.3.7 (18/09/2026), com dados trocados.
const GRUPO = '120363412069179864@g.us';

describe('lerConteudo', () => {
  it('texto simples e texto estendido', () => {
    expect(lerConteudo('conversation', { conversation: 'oi' })).toMatchObject({ tipo: 'texto', texto: 'oi' });
    expect(lerConteudo('extendedTextMessage', { extendedTextMessage: { text: 'link' } }).texto).toBe('link');
  });

  it('imagem com legenda, vídeo-bolinha e documento com legenda', () => {
    expect(lerConteudo('imageMessage', { imageMessage: { caption: 'Live' } })).toMatchObject({
      tipo: 'imagem',
      texto: 'Live',
    });
    expect(lerConteudo('ptvMessage', { ptvMessage: {} }).tipo).toBe('video');
    expect(
      lerConteudo('documentWithCaptionMessage', {
        documentWithCaptionMessage: { message: { documentMessage: { fileName: 'roteiro.pdf', caption: 'segue' } } },
      }),
    ).toEqual({ tipo: 'documento', texto: 'segue', arquivo: 'roteiro.pdf' });
  });

  it('enquete v3 mostra a pergunta', () => {
    expect(lerConteudo('pollCreationMessageV3', { pollCreationMessageV3: { name: 'Qual data?' } })).toMatchObject({
      tipo: 'enquete',
      texto: 'Qual data?',
    });
  });

  it('corpo vazio cai no tipo pelo nome', () => {
    expect(lerConteudo('audioMessage', null).tipo).toBe('audio');
    expect(previa('audio', null)).toBe('🎤 Áudio');
  });
});

describe('tiques', () => {
  it('fica com o status mais avançado', () => {
    expect(melhorTique('SERVER_ACK', 'READ', 'DELIVERY_ACK')).toBe('lido');
    expect(melhorTique(2, 3)).toBe('entregue');
    expect(melhorTique(undefined)).toBeNull();
  });
});

describe('paraBalao', () => {
  it('nossa imagem num grupo sem atualização = enviado (grupo não devolve entregue)', () => {
    const b = paraBalao({
      key: { id: '3EB0', fromMe: true, remoteJid: GRUPO },
      pushName: 'Você',
      messageType: 'imageMessage',
      message: { imageMessage: { caption: 'Domingo, 20h' } },
      messageTimestamp: 1789752037,
      MessageUpdate: [],
    });
    expect(b).toMatchObject({
      id: '3EB0',
      fromMe: true,
      tipo: 'imagem',
      texto: 'Domingo, 20h',
      tique: 'enviado',
      autor: null,
    });
  });

  it('mensagem de sistema não vira balão', () => {
    expect(paraBalao({ key: { id: 'x' }, messageType: 'protocolMessage', message: {} })).toBeNull();
    expect(paraBalao({ key: { id: 'x' }, messageType: 'reactionMessage', message: {} })).toBeNull();
  });

  it('mensagem recebida guarda o autor e não tem tique', () => {
    const b = paraBalao({
      key: { id: 'y', fromMe: false, remoteJid: GRUPO },
      pushName: 'Beatriz',
      messageType: 'conversation',
      message: { conversation: 'Vou!' },
      messageTimestamp: 1789752100,
    });
    expect(b).toMatchObject({ autor: 'Beatriz', tique: null });
  });
});

describe('paraConversa', () => {
  it('grupo usa o nome cadastrado, não o pushName de quem falou por último', () => {
    const c = paraConversa(
      {
        remoteJid: GRUPO,
        pushName: 'Fulano',
        lastMessage: {
          key: { fromMe: true },
          messageType: 'conversation',
          message: { conversation: 'oi' },
          messageTimestamp: 10,
        },
      },
      new Map([[GRUPO, 'Live - Japão & China']]),
    );
    expect(c).toMatchObject({
      nome: 'Live - Japão & China',
      grupo: true,
      ultima: { texto: 'oi', fromMe: true, ts: 10 },
    });
  });

  it('contato @lid mostra o telefone real do remoteJidAlt', () => {
    const c = paraConversa(
      {
        remoteJid: '48383460909252@lid',
        pushName: 'Beatriz',
        lastMessage: {
          key: { fromMe: true, remoteJidAlt: '5511940000000@s.whatsapp.net' },
          messageType: 'audioMessage',
          messageTimestamp: 5,
        },
      },
      new Map(),
    );
    expect(c).toMatchObject({ nome: 'Beatriz', telefone: '5511940000000', ultima: { texto: '🎤 Áudio' } });
  });

  it('status@broadcast fica de fora', () => {
    expect(paraConversa({ remoteJid: 'status@broadcast' }, new Map())).toBeNull();
  });
});

describe('podeEditar', () => {
  it('só texto nosso nos primeiros 15 minutos', () => {
    const base = { fromMe: true, tipo: 'texto' as const, ts: 1000 };
    expect(podeEditar(base, 1000 + 14 * 60)).toBe(true);
    expect(podeEditar(base, 1000 + 16 * 60)).toBe(false);
    expect(podeEditar({ ...base, tipo: 'imagem' }, 1001)).toBe(false);
    expect(podeEditar({ ...base, fromMe: false }, 1001)).toBe(false);
  });
});
