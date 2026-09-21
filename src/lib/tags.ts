// Tags de grupo — as regras que não dependem de banco, para dar para testar.
import type { Group, GroupTag } from './types';

/** Paleta das tags: legível sobre o fundo escuro do painel e diferente entre si. */
export const CORES_DE_TAG = [
  '#D7F264', // lima (a cor da marca)
  '#7CD4FD', // azul
  '#F5A26B', // laranja
  '#F7B5BD', // rosa
  '#B9A7FF', // lilás
  '#6EE7B7', // verde-água
  '#FDE68A', // amarelo
  '#CBD5E1', // cinza
] as const;

export const NOME_TAG_MAX = 40;

/** Nome limpo (espaços colapsados) ou a mensagem de erro para a tela. */
export function validarNomeTag(bruto: unknown): { nome: string } | { erro: string } {
  const nome = String(bruto ?? '').replace(/\s+/g, ' ').trim();
  if (!nome) return { erro: 'Dê um nome à tag.' };
  if (nome.length > NOME_TAG_MAX) return { erro: `Use até ${NOME_TAG_MAX} letras no nome da tag.` };
  return { nome };
}

export function corValida(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);
}

/** Linha de `groups` com a ligação embutida (`group_tag_links(tag_id)`) → Group com tag_ids. */
export function comTagIds(linha: Record<string, unknown>): Group {
  const { group_tag_links: links, ...resto } = linha;
  const tag_ids = Array.isArray(links)
    ? links.map((l) => String((l as { tag_id?: unknown })?.tag_id ?? '')).filter(Boolean)
    : [];
  return { ...(resto as unknown as Group), tag_ids };
}

/**
 * Os `group_id` (JID) dos grupos que têm a tag. Só os ATIVOS por padrão: é o que o
 * seletor de destino pode marcar — grupo inativo não recebe campanha.
 */
export function gruposDaTag(grupos: Group[], tagId: string, soAtivos = true): string[] {
  return grupos
    .filter((g) => (g.tag_ids ?? []).includes(tagId) && (!soAtivos || g.ativo))
    .map((g) => g.group_id);
}

/** Quantos grupos carregam cada tag (para o número ao lado do nome). */
export function contarPorTag(grupos: Group[]): Record<string, number> {
  const conta: Record<string, number> = {};
  for (const g of grupos) for (const t of g.tag_ids ?? []) conta[t] = (conta[t] ?? 0) + 1;
  return conta;
}

/** Ordem de exibição: alfabética, sem ligar para acento e maiúscula. */
export function ordenarTags(tags: GroupTag[]): GroupTag[] {
  return [...tags].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}
