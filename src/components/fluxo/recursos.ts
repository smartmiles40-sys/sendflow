'use client';

// Dados de apoio dos formulários (campos personalizados, listas, fluxos, números
// oficiais), buscados uma vez por página e compartilhados por todos os editores.

import { useEffect, useState } from 'react';
import type { WhatsAppTemplate } from '@/lib/types';

export interface Recursos {
  campos: { chave: string; rotulo: string }[];
  listas: { id: string; nome: string }[];
  fluxos: { id: string; nome: string; status: string }[];
  conexoes: { id: string; nome: string; numero: string | null; status: string }[];
  carregado: boolean;
}

const VAZIO: Recursos = { campos: [], listas: [], fluxos: [], conexoes: [], carregado: false };

async function json<T>(url: string, padrao: T): Promise<T> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : padrao;
  } catch {
    return padrao;
  }
}

export function useRecursos(): Recursos {
  const [r, setR] = useState<Recursos>(VAZIO);
  useEffect(() => {
    let vivo = true;
    void Promise.all([
      json<{ campos?: Recursos['campos'] }>('/api/campos', {}),
      json<Recursos['listas']>('/api/lists', []),
      json<{ fluxos?: Recursos['fluxos'] }>('/api/fluxos', {}),
      json<{ conexoes?: (Recursos['conexoes'][number] & { provider: string })[] }>('/api/connections', {}),
    ]).then(([c, l, f, x]) => {
      if (!vivo) return;
      setR({
        campos: c.campos ?? [],
        listas: Array.isArray(l) ? l : [],
        fluxos: f.fluxos ?? [],
        conexoes: (x.conexoes ?? []).filter((k) => k.provider === 'cloud'),
        carregado: true,
      });
    });
    return () => {
      vivo = false;
    };
  }, []);
  return r;
}

const cacheTemplates = new Map<string, Promise<WhatsAppTemplate[]>>();

/** Templates já sincronizados de um número (GET não vai à Meta). */
export function buscarTemplates(conexaoId: string, forcar = false): Promise<WhatsAppTemplate[]> {
  if (!forcar && cacheTemplates.has(conexaoId)) return cacheTemplates.get(conexaoId)!;
  const p = fetch(`/api/connections/${conexaoId}/templates`, { method: forcar ? 'POST' : 'GET' })
    .then((r) => (r.ok ? r.json() : { templates: [] }))
    .then((b: { templates?: WhatsAppTemplate[] }) => b.templates ?? [])
    .catch(() => [] as WhatsAppTemplate[]);
  cacheTemplates.set(conexaoId, p);
  return p;
}
