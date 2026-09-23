// Pequenas peças de servidor compartilhadas pelas rotas das automações.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Connection } from '../types';

/**
 * O número oficial para uma ação: o pedido explicitamente, ou o do fluxo, ou o único
 * conectado. Com dois números e nenhum escolhido, é melhor recusar do que chutar —
 * mandar pelo número errado abre a conversa no WhatsApp errado.
 */
export async function escolherConexaoOficial(
  db: SupabaseClient,
  preferida?: string | null,
): Promise<{ conexao: Connection } | { erro: string }> {
  const { data } = await db
    .from('connections')
    .select('*')
    .eq('provider', 'cloud')
    .order('criado_em', { ascending: true });
  const todas = (data ?? []) as Connection[];
  if (preferida) {
    const c = todas.find((x) => x.id === preferida);
    return c ? { conexao: c } : { erro: 'Número oficial não encontrado.' };
  }
  const conectadas = todas.filter((c) => c.status === 'conectada');
  if (conectadas.length === 1) return { conexao: conectadas[0] };
  if (!conectadas.length) return { erro: 'Nenhum número oficial conectado. Conecte em Conexões → Conectar com a Meta.' };
  return { erro: 'Há mais de um número oficial: escolha por qual enviar.' };
}

/** Token aleatório para o gatilho de webhook externo. */
export function novoToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
