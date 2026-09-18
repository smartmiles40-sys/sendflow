import { describe, it, expect } from 'vitest';
import { lerDestino, nomeDoPasso, passoEditavel, validarPasso } from './cadencia';

const AGORA = new Date('2026-09-18T15:00:00.000Z');

describe('lerDestino', () => {
  it('destino vazio é erro — nunca vira "todos os grupos"', () => {
    const { errors } = lerDestino({ alvo: 'grupos' });
    expect(errors.map((e) => e.field)).toEqual(['destino']);
  });

  it('público salvo ignora a lista de grupos avulsos', () => {
    const { destino, errors } = lerDestino({ audience_id: 'p1', group_ids: ['a@g.us'] });
    expect(errors).toEqual([]);
    expect(destino).toMatchObject({ alvo: 'grupos', audience_id: 'p1', group_ids: null });
  });

  it('grupos avulsos limpam entradas vazias', () => {
    const { destino } = lerDestino({ group_ids: ['a@g.us', '', 3] });
    expect(destino.group_ids).toEqual(['a@g.us']);
  });

  it('contatos exigem lista e zeram os campos de grupo', () => {
    expect(lerDestino({ alvo: 'contatos' }).errors).toHaveLength(1);
    const { destino } = lerDestino({ alvo: 'contatos', list_ids: ['l1'], group_ids: ['a@g.us'] });
    expect(destino).toMatchObject({ alvo: 'contatos', list_ids: ['l1'], group_ids: null, audience_id: null });
  });
});

describe('validarPasso', () => {
  const ok = {
    tipo: 'texto' as const,
    mensagem: 'Oi',
    midia_url: null,
    mencionar_todos: false,
    enviar_em: '2026-09-19T12:00:00Z',
  };

  it('passo completo e no futuro passa', () => {
    expect(validarPasso(ok, AGORA)).toEqual([]);
  });

  it('data no passado ou ausente é erro', () => {
    expect(validarPasso({ ...ok, enviar_em: '2026-09-18T14:00:00Z' }, AGORA)[0].field).toBe('enviar_em');
    expect(validarPasso({ ...ok, enviar_em: null }, AGORA)[0].field).toBe('enviar_em');
  });

  it('mídia é obrigatória fora do "só texto"', () => {
    expect(validarPasso({ ...ok, tipo: 'imagem' }, AGORA).map((e) => e.field)).toEqual(['midia_url']);
  });

  it('texto só com espaços não conta', () => {
    expect(validarPasso({ ...ok, mensagem: '   ' }, AGORA).map((e) => e.field)).toEqual(['mensagem']);
  });
});

describe('nomeDoPasso / passoEditavel', () => {
  it('nome leva a data de Brasília', () => {
    expect(nomeDoPasso(' Live Japão ', '2026-09-20T23:00:00Z')).toBe('Live Japão · 20/09 20:00');
  });

  it('só o que não saiu é editável', () => {
    expect(passoEditavel('agendada')).toBe(true);
    expect(passoEditavel('rascunho')).toBe(true);
    expect(passoEditavel('enviando')).toBe(false);
    expect(passoEditavel('enviada')).toBe(false);
  });
});
