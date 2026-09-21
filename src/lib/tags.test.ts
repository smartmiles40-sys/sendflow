import { describe, it, expect } from 'vitest';
import { comTagIds, contarPorTag, corValida, gruposDaTag, ordenarTags, validarNomeTag } from './tags';
import type { Group } from './types';

const g = (id: string, ativo: boolean, tag_ids: string[]): Group => ({
  id,
  group_id: `${id}@g.us`,
  nome: id,
  ativo,
  criado_em: '',
  tag_ids,
});

describe('validarNomeTag', () => {
  it('limpa espaços', () => {
    expect(validarNomeTag('  Live   Peru ')).toEqual({ nome: 'Live Peru' });
  });
  it('vazio e longo demais são recusados', () => {
    expect(validarNomeTag('   ')).toHaveProperty('erro');
    expect(validarNomeTag('x'.repeat(41))).toHaveProperty('erro');
  });
});

describe('corValida', () => {
  it('só #RRGGBB', () => {
    expect(corValida('#D7F264')).toBe(true);
    expect(corValida('red')).toBe(false);
    expect(corValida('#fff')).toBe(false);
  });
});

describe('comTagIds', () => {
  it('achata a ligação embutida do PostgREST em tag_ids', () => {
    const r = comTagIds({ id: '1', nome: 'x', group_tag_links: [{ tag_id: 'a' }, { tag_id: 'b' }] });
    expect(r.tag_ids).toEqual(['a', 'b']);
    expect(r).not.toHaveProperty('group_tag_links');
  });
  it('sem ligação = lista vazia', () => {
    expect(comTagIds({ id: '1' }).tag_ids).toEqual([]);
  });
});

describe('gruposDaTag', () => {
  const grupos = [g('a', true, ['live']), g('b', false, ['live']), g('c', true, ['outra'])];
  it('só os ativos por padrão (inativo não recebe campanha)', () => {
    expect(gruposDaTag(grupos, 'live')).toEqual(['a@g.us']);
  });
  it('com soAtivos=false traz todos da tag', () => {
    expect(gruposDaTag(grupos, 'live', false)).toEqual(['a@g.us', 'b@g.us']);
  });
});

describe('contarPorTag / ordenarTags', () => {
  it('conta grupos por tag', () => {
    expect(contarPorTag([g('a', true, ['x', 'y']), g('b', true, ['x'])])).toEqual({ x: 2, y: 1 });
  });
  it('ordena sem ligar para acento/maiúscula', () => {
    const t = (nome: string) => ({ id: nome, nome, cor: '#000000', criado_em: '' });
    expect(ordenarTags([t('zebra'), t('Água'), t('abacate')]).map((x) => x.nome)).toEqual(['abacate', 'Água', 'zebra']);
  });
});
