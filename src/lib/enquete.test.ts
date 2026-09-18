import { describe, it, expect } from 'vitest';
import { limparOpcoes, validarEnquete } from './enquete';
import { validateCampaign } from './validation';
import { validarPasso } from './cadencia';
import { buildCampaignRow } from './campaign-row';
import { montarEnvio } from './whatsapp/evolution';

describe('limparOpcoes', () => {
  it('tira espaços, vazias e repetidas (sem diferenciar maiúscula)', () => {
    expect(limparOpcoes([' Sim ', '', 'sim', 'Não', 3, '  '])).toEqual(['Sim', 'Não']);
  });

  it('qualquer coisa que não seja lista vira lista vazia', () => {
    expect(limparOpcoes(null)).toEqual([]);
    expect(limparOpcoes('Sim')).toEqual([]);
  });
});

describe('validarEnquete', () => {
  it('precisa de pergunta e de 2 a 12 opções', () => {
    expect(validarEnquete('Vai?', ['Sim', 'Não'])).toEqual([]);
    expect(validarEnquete('', ['Sim', 'Não']).map((e) => e.field)).toEqual(['mensagem']);
    expect(validarEnquete('Vai?', ['Sim']).map((e) => e.field)).toEqual(['enquete_opcoes']);
    const treze = Array.from({ length: 13 }, (_, i) => `op ${i}`);
    expect(validarEnquete('Vai?', treze).map((e) => e.field)).toEqual(['enquete_opcoes']);
  });
});

describe('enquete na campanha e na cadência', () => {
  const base = {
    nome: 'Horário da live',
    tipo: 'enquete' as const,
    mensagem: 'Qual horário?',
    midia_url: 'https://x/y.png',
    mencionar_todos: true,
    agendar: false,
    enviar_em: null,
  };

  it('não exige mídia, mas exige opções', () => {
    expect(validateCampaign({ ...base, enquete_opcoes: ['19h', '20h'] }, new Date())).toEqual([]);
    expect(validateCampaign({ ...base, enquete_opcoes: ['19h', '19h'] }, new Date()).map((e) => e.field)).toEqual([
      'enquete_opcoes',
    ]);
  });

  it('a linha salva limpa as opções e descarta mídia esquecida', () => {
    const row = buildCampaignRow(
      { ...base, enquete_opcoes: [' 19h', '20h', ''], enquete_multipla: true },
      { groupIds: ['g@g.us'] },
      new Date('2026-09-18T12:00:00Z'),
      { asDraft: false },
    );
    expect(row).toMatchObject({ tipo: 'enquete', midia_url: null, enquete_opcoes: ['19h', '20h'], enquete_multipla: true });
  });

  it('passo de cadência enquete valida as opções', () => {
    const passo = { tipo: 'enquete' as const, mensagem: 'Vai?', midia_url: null, mencionar_todos: false, enviar_em: '2030-01-01T00:00:00Z' };
    expect(validarPasso({ ...passo, enquete_opcoes: ['Sim', 'Não'] }, new Date())).toEqual([]);
    expect(validarPasso({ ...passo, enquete_opcoes: [] }, new Date()).map((e) => e.field)).toEqual(['enquete_opcoes']);
  });
});

describe('montarEnvio — enquete', () => {
  it('vai para sendPoll com a pergunta em name e as opções em values', () => {
    const r = montarEnvio('inst-1', {
      destino: '120363412069179864@g.us',
      tipo: 'enquete',
      texto: 'Qual horário?',
      mencionarTodos: true,
      enquete: { opcoes: ['19h', '20h', '21h'], multipla: false },
    });
    expect(r.caminho).toBe('/message/sendPoll/inst-1');
    expect(r.corpo).toEqual({
      number: '120363412069179864@g.us',
      name: 'Qual horário?',
      selectableCount: 1,
      values: ['19h', '20h', '21h'],
      mentionsEveryOne: true,
    });
  });

  it('"várias respostas" libera marcar todas as opções', () => {
    const r = montarEnvio('inst-1', {
      destino: '5511999999999',
      tipo: 'enquete',
      texto: 'Quais destinos?',
      enquete: { opcoes: ['Japão', 'Peru'], multipla: true },
    });
    expect(r.corpo.selectableCount).toBe(2);
    expect(r.corpo).not.toHaveProperty('mentionsEveryOne');
  });
});
