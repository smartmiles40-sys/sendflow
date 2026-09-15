import { describe, it, expect } from 'vitest';
import {
  DIAS_SEMANA_LABEL,
  buildRecorrenciaRow,
  describeRecorrencia,
  nextOccurrences,
} from './recurrence';
import type { Recorrencia } from './types';

// 2026-08-28 é uma sexta-feira. 12:00Z = 09:00 em São Paulo (UTC−03:00).
const SEXTA_09H_SP = '2026-08-28T12:00:00.000Z';

describe('nextOccurrences', () => {
  it('começa hoje quando é o dia da semana e a hora ainda não passou', () => {
    // Sexta 09:00 SP, recorrência sexta 10:00 → hoje mesmo, 13:00Z.
    const out = nextOccurrences(5, '10:00', SEXTA_09H_SP, 1);
    expect(out).toEqual(['2026-08-28T13:00:00.000Z']);
  });

  it('pula para a próxima semana quando a hora de hoje já passou', () => {
    const out = nextOccurrences(5, '08:00', SEXTA_09H_SP, 1);
    expect(out).toEqual(['2026-09-04T11:00:00.000Z']);
  });

  it('pula a ocorrência exatamente igual a agora (nada é agendado no instante presente)', () => {
    const out = nextOccurrences(5, '09:00', SEXTA_09H_SP, 1);
    expect(out).toEqual(['2026-09-04T12:00:00.000Z']);
  });

  it('encontra o próximo dia da semana à frente na mesma semana', () => {
    // Sexta (5) buscando segunda (1) → segunda seguinte, 31/08.
    const out = nextOccurrences(1, '09:00', SEXTA_09H_SP, 1);
    expect(out).toEqual(['2026-08-31T12:00:00.000Z']);
  });

  it('trata domingo (0) como dia válido', () => {
    const out = nextOccurrences(0, '09:00', SEXTA_09H_SP, 1);
    expect(out).toEqual(['2026-08-30T12:00:00.000Z']);
  });

  it('devolve N ocorrências espaçadas de 7 dias, virando o mês', () => {
    const out = nextOccurrences(1, '09:00', SEXTA_09H_SP, 3);
    expect(out).toEqual([
      '2026-08-31T12:00:00.000Z',
      '2026-09-07T12:00:00.000Z',
      '2026-09-14T12:00:00.000Z',
    ]);
  });

  it('vira o ano corretamente', () => {
    // 2026-12-28 é uma segunda; 12:00Z = 09:00 SP.
    const out = nextOccurrences(1, '09:00', '2026-12-28T12:30:00.000Z', 2);
    expect(out).toEqual(['2027-01-04T12:00:00.000Z', '2027-01-11T12:00:00.000Z']);
  });

  it('converte a hora de São Paulo para UTC (soma 3h)', () => {
    const out = nextOccurrences(1, '19:30', SEXTA_09H_SP, 1);
    expect(out).toEqual(['2026-08-31T22:30:00.000Z']);
  });

  it('usa a data local de São Paulo, não a UTC, para saber que dia é hoje', () => {
    // 2026-08-31T01:00:00Z ainda é domingo 22:00 em São Paulo. Uma recorrência de
    // domingo às 23:00 deve cair hoje (domingo SP), não daqui a uma semana.
    const out = nextOccurrences(0, '23:00', '2026-08-31T01:00:00.000Z', 1);
    expect(out).toEqual(['2026-08-31T02:00:00.000Z']);
  });

  it('devolve lista vazia quando o horizonte é zero ou negativo', () => {
    expect(nextOccurrences(1, '09:00', SEXTA_09H_SP, 0)).toEqual([]);
    expect(nextOccurrences(1, '09:00', SEXTA_09H_SP, -3)).toEqual([]);
  });
});

const REC: Recorrencia = {
  id: 'r1',
  nome: 'P360 semanal',
  categoria: 'p360',
  dia_semana: 1,
  hora: '09:00',
  tipo: 'texto',
  mensagem: 'Bom dia, pessoal!',
  midia_url: null,
  mencionar_todos: false,
  audience_id: 'aud-1',
  group_ids: null,
  ativo: true,
  criado_em: '2026-08-28T00:00:00.000Z',
  atualizado_em: '2026-08-28T00:00:00.000Z',
};

describe('buildRecorrenciaRow', () => {
  it('copia o conteúdo e o público do molde e agenda a ocorrência', () => {
    const row = buildRecorrenciaRow(REC, '2026-08-31T12:00:00.000Z');
    expect(row).toEqual({
      nome: 'P360 semanal — 31/08',
      tipo: 'texto',
      categoria: 'p360',
      mensagem: 'Bom dia, pessoal!',
      midia_url: null,
      mencionar_todos: false,
      audience_id: 'aud-1',
      group_ids: null,
      // Recorrência é sempre para grupos: o molde semanal não tem tela para escolher
      // lista de contatos, e deixar o alvo ambíguo faria o fan-out olhar o lado errado.
      alvo: 'grupos',
      list_ids: null,
      connection_id: null,
      enviar_em: '2026-08-31T12:00:00.000Z',
      status: 'agendada',
      recorrencia_id: 'r1',
    });
  });

  it('leva a conexão do molde para a ocorrência', () => {
    const row = buildRecorrenciaRow({ ...REC, connection_id: 'conexao-1' }, '2026-08-31T12:00:00.000Z');
    expect(row.connection_id).toBe('conexao-1');
  });

  it('usa a data de São Paulo no nome, não a UTC', () => {
    // 01:00Z de 01/09 ainda é 31/08 às 22:00 em São Paulo.
    const row = buildRecorrenciaRow(REC, '2026-09-01T01:00:00.000Z');
    expect(row.nome).toBe('P360 semanal — 31/08');
  });

  it('mantém mídia e grupos avulsos quando o molde os tem', () => {
    const row = buildRecorrenciaRow(
      { ...REC, tipo: 'imagem', midia_url: 'https://x/y.png', group_ids: ['g1', 'g2'], audience_id: null },
      '2026-08-31T12:00:00.000Z',
    );
    expect(row.tipo).toBe('imagem');
    expect(row.midia_url).toBe('https://x/y.png');
    expect(row.group_ids).toEqual(['g1', 'g2']);
    expect(row.audience_id).toBeNull();
  });
});

describe('describeRecorrencia', () => {
  it('descreve a cadência em português', () => {
    expect(describeRecorrencia(1, '09:00')).toBe('Toda segunda-feira às 09:00');
    expect(describeRecorrencia(0, '19:30')).toBe('Todo domingo às 19:30');
    expect(describeRecorrencia(6, '08:00')).toBe('Todo sábado às 08:00');
  });

  it('expõe os rótulos dos 7 dias na ordem do getDay()', () => {
    expect(DIAS_SEMANA_LABEL).toHaveLength(7);
    expect(DIAS_SEMANA_LABEL[0]).toBe('domingo');
    expect(DIAS_SEMANA_LABEL[6]).toBe('sábado');
  });
});
