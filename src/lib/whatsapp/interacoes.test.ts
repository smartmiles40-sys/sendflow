import { describe, it, expect } from 'vitest';
import { juntarReacoes, lerCitacao, paraBalao } from './conversas';
import { montarCitacao, rotaGrupo, traduzirErroWhatsApp } from './evolution';

const GRUPO = '120363412069179864@g.us';

const reacao = (alvo: string, emoji: string, autor: string | 'eu', ts: number) => ({
  key: autor === 'eu' ? { id: `r${ts}`, fromMe: true, remoteJid: GRUPO } : { id: `r${ts}`, fromMe: false, remoteJid: GRUPO, participant: autor },
  messageType: 'reactionMessage',
  message: { reactionMessage: { key: { id: alvo }, text: emoji } },
  messageTimestamp: ts,
});

describe('juntarReacoes', () => {
  it('soma por emoji e marca a minha', () => {
    const m = juntarReacoes([
      reacao('M1', '👍', 'a@lid', 1),
      reacao('M1', '👍', 'b@lid', 2),
      reacao('M1', '❤️', 'eu', 3),
    ]);
    expect(m.get('M1')).toEqual([
      { emoji: '👍', quantos: 2, minha: false },
      { emoji: '❤️', quantos: 1, minha: true },
    ]);
  });

  it('cada pessoa vale uma reação: a mais recente troca a anterior', () => {
    const m = juntarReacoes([reacao('M1', '👍', 'a@lid', 1), reacao('M1', '😂', 'a@lid', 5)]);
    expect(m.get('M1')).toEqual([{ emoji: '😂', quantos: 1, minha: false }]);
  });

  it('reação vazia = tirou a reação', () => {
    const m = juntarReacoes([reacao('M1', '👍', 'a@lid', 1), reacao('M1', '', 'a@lid', 2)]);
    expect(m.has('M1')).toBe(false);
  });

  it('ignora o que não é reação', () => {
    expect(juntarReacoes([{ messageType: 'conversation', message: { conversation: 'oi' } }]).size).toBe(0);
  });
});

describe('lerCitacao', () => {
  it('resposta de texto: contextInfo dentro do extendedTextMessage', () => {
    const c = lerCitacao({
      message: {
        extendedTextMessage: {
          text: 'concordo',
          contextInfo: { stanzaId: 'ORIG', quotedMessage: { conversation: 'a live é às 20h' } },
        },
      },
    });
    expect(c).toEqual({ id: 'ORIG', texto: 'a live é às 20h' });
  });

  it('contextInfo copiado para fora pela Evolution também vale', () => {
    const c = lerCitacao({ message: { conversation: 'x' }, contextInfo: { stanzaId: 'O2', quotedMessage: { imageMessage: {} } } });
    expect(c).toEqual({ id: 'O2', texto: '📷 Foto' });
  });

  it('mensagem que não é resposta: null', () => {
    expect(lerCitacao({ message: { conversation: 'oi' } })).toBeNull();
  });
});

describe('paraBalao — autor em grupo', () => {
  it('guarda o participant (preciso para responder, reagir e apagar como admin)', () => {
    const b = paraBalao({
      key: { id: 'X', fromMe: false, remoteJid: GRUPO, participant: '999@lid' },
      messageType: 'conversation',
      message: { conversation: 'oi' },
      messageTimestamp: 10,
      pushName: 'Ana',
    });
    expect(b?.participant).toBe('999@lid');
    expect(b?.reacoes).toEqual([]);
    expect(b?.citacao).toBeNull();
  });
});

describe('montarCitacao', () => {
  it('com texto: manda a chave e o texto', () => {
    expect(montarCitacao(GRUPO, { id: 'A', fromMe: false, participant: '1@lid', texto: 'oi' })).toEqual({
      key: { id: 'A', remoteJid: GRUPO, fromMe: false, participant: '1@lid' },
      message: { conversation: 'oi' },
    });
  });
  it('sem texto (mídia): só a chave, para a Evolution achar a original', () => {
    expect(montarCitacao(GRUPO, { id: 'A', fromMe: true })).toEqual({ key: { id: 'A', remoteJid: GRUPO, fromMe: true } });
  });
});

describe('rotaGrupo', () => {
  it('o grupo vai na query string, escapado', () => {
    expect(rotaGrupo('updateSetting', 'inst 1', GRUPO)).toBe(
      '/group/updateSetting/inst%201?groupJid=120363412069179864%40g.us',
    );
  });
});

describe('traduzirErroWhatsApp', () => {
  it('forbidden vira "precisa ser admin"', () => {
    expect(traduzirErroWhatsApp('400: Error updating participants; Error: forbidden')).toMatch(/admin do grupo/);
  });
  it('[object Object] da Evolution vira uma frase legível', () => {
    expect(traduzirErroWhatsApp('400: [object Object]')).toMatch(/não encontrado/);
  });
  it('erro desconhecido passa como veio', () => {
    expect(traduzirErroWhatsApp('502: gateway')).toBe('502: gateway');
  });
});
