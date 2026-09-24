import { describe, expect, it } from 'vitest';
import { CAMPOS, condicaoPadrao, regrasDosFiltros, somarFiltros, validarRegras } from './segmentos';

const LISTA = '0b6a3c1e-2f4d-4a5b-8c7d-9e0f1a2b3c4d';

describe('validarRegras', () => {
  it('aceita regras vazias como "todos"', () => {
    expect(validarRegras({})).toEqual({ ok: true, regras: { combinar: 'todas', condicoes: [] } });
  });

  it('mantém "qualquer" e descarta combinar desconhecido', () => {
    const r = validarRegras({ combinar: 'qualquer', condicoes: [] });
    expect(r.ok && r.regras.combinar).toBe('qualquer');
    const r2 = validarRegras({ combinar: 'xpto', condicoes: [] });
    expect(r2.ok && r2.regras.combinar).toBe('todas');
  });

  it('recusa operador que o banco não conhece', () => {
    const r = validarRegras({ condicoes: [{ campo: 'tag', op: 'drop table' }] });
    expect(r).toEqual({ ok: false, erro: 'Condição 1: escolha o campo e a regra.' });
  });

  it('exige valor de texto, número de dias e uuid de lista', () => {
    expect(validarRegras({ condicoes: [{ campo: 'tag', op: 'tem', valor: ' ' }] }).ok).toBe(false);
    expect(validarRegras({ condicoes: [{ campo: 'criado', op: 'ultimos_dias', valor: 'sete' }] }).ok).toBe(false);
    expect(validarRegras({ condicoes: [{ campo: 'lista', op: 'esta', valor: 'minha lista' }] }).ok).toBe(false);
    expect(validarRegras({ condicoes: [{ campo: 'lista', op: 'esta', valor: LISTA }] }).ok).toBe(true);
  });

  it('não guarda valor em operador sem valor', () => {
    const r = validarRegras({ condicoes: [{ campo: 'abriu_email', op: 'nunca', valor: 'lixo' }] });
    expect(r.ok && r.regras.condicoes[0]).toEqual({ campo: 'abriu_email', op: 'nunca' });
  });

  it('campo personalizado precisa de chave válida', () => {
    expect(validarRegras({ condicoes: [{ campo: 'campo', op: 'igual', valor: 'x', chave: "a'b" }] }).ok).toBe(false);
    const r = validarRegras({ condicoes: [{ campo: 'campo', op: 'maior', valor: '2.5', chave: 'renda' }] });
    expect(r.ok && r.regras.condicoes[0]).toEqual({ campo: 'campo', op: 'maior', valor: '2.5', chave: 'renda' });
  });

  it('pontuação só aceita inteiro', () => {
    expect(validarRegras({ condicoes: [{ campo: 'score', op: 'maior_igual', valor: '2.5' }] }).ok).toBe(false);
    expect(validarRegras({ condicoes: [{ campo: 'score', op: 'maior_igual', valor: '10' }] }).ok).toBe(true);
  });

  it('limita a 30 condições', () => {
    const muitas = Array.from({ length: 31 }, () => ({ campo: 'tag', op: 'tem', valor: 'x' }));
    expect(validarRegras({ condicoes: muitas }).ok).toBe(false);
  });
});

describe('condicaoPadrao', () => {
  it('toda condição padrão tem operador conhecido', () => {
    for (const c of CAMPOS) {
      const p = condicaoPadrao(c.campo);
      expect(c.ops.some((o) => o.op === p.op)).toBe(true);
    }
  });
});

describe('regrasDosFiltros', () => {
  it('converte os filtros rápidos e ignora lista que não é uuid', () => {
    expect(regrasDosFiltros({ lista: LISTA, tag: 'vip', status_email: 'ativo' })).toEqual([
      { campo: 'lista', op: 'esta', valor: LISTA },
      { campo: 'tag', op: 'tem', valor: 'vip' },
      { campo: 'status_email', op: 'igual', valor: 'ativo' },
    ]);
    expect(regrasDosFiltros({ lista: 'x' })).toEqual([]);
  });
});

describe('somarFiltros', () => {
  const lista = { campo: 'lista' as const, op: 'esta', valor: LISTA };
  it('segmento "qualquer" entra como grupo, para não virar OU com o filtro', () => {
    const base = { combinar: 'qualquer' as const, condicoes: [{ campo: 'tag' as const, op: 'tem', valor: 'a' }, { campo: 'tag' as const, op: 'tem', valor: 'b' }] };
    expect(somarFiltros(base, [lista])).toEqual({ combinar: 'todas', condicoes: [lista, base] });
  });
  it('segmento "todas" só ganha as condições no fim', () => {
    const base = { combinar: 'todas' as const, condicoes: [{ campo: 'tag' as const, op: 'tem', valor: 'a' }] };
    expect(somarFiltros(base, [lista]).condicoes).toHaveLength(2);
  });
  it('sem filtro rápido devolve o segmento como está', () => {
    const base = { combinar: 'qualquer' as const, condicoes: [] };
    expect(somarFiltros(base, [])).toBe(base);
  });
});
