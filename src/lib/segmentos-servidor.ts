// Resolver segmento no banco (0023). Fica separado de segmentos.ts porque aquele
// arquivo também roda no navegador, e este fala com o Supabase.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from './types';
import type { Regras } from './segmentos';

export const POR_PAGINA = 100;

/** Uma página de contatos que casam com as regras, na ordem do banco, com o total. */
export async function filtrarContatos(
  supabase: SupabaseClient,
  regras: Regras,
  opcoes: { busca?: string | null; pagina?: number } = {},
): Promise<{ contatos: Contact[]; total: number } | { erro: string }> {
  const pagina = Math.max(0, opcoes.pagina ?? 0);
  const { data, error } = await supabase.rpc('sf_filtrar_contatos', {
    p_regras: regras,
    p_busca: opcoes.busca?.trim() || null,
    p_limite: POR_PAGINA,
    p_offset: pagina * POR_PAGINA,
  });
  if (error) return { erro: error.message };
  const linhas = (data ?? []) as { id: string; total: number }[];
  if (!linhas.length) return { contatos: [], total: 0 };

  const { data: contatos, error: e2 } = await supabase
    .from('contacts')
    .select('*')
    .in('id', linhas.map((l) => l.id));
  if (e2) return { erro: e2.message };
  const porId = new Map(((contatos ?? []) as Contact[]).map((c) => [c.id, c]));
  return {
    contatos: linhas.map((l) => porId.get(l.id)).filter((c): c is Contact => Boolean(c)),
    total: Number(linhas[0].total),
  };
}

/**
 * TODOS os ids do segmento, em páginas de 1000 com ordem estável (criado_em, id) — o
 * PostgREST corta em 1000 sem avisar, então pedir "tudo de uma vez" mentiria.
 */
export async function idsDoSegmento(supabase: SupabaseClient, regras: Regras): Promise<{ ids: string[] } | { erro: string }> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.rpc('sf_filtrar_contatos', {
      p_regras: regras,
      p_busca: null,
      p_limite: 1000,
      p_offset: offset,
    });
    if (error) return { erro: error.message };
    const linhas = (data ?? []) as { id: string }[];
    ids.push(...linhas.map((l) => l.id));
    if (linhas.length < 1000) break;
  }
  return { ids };
}
