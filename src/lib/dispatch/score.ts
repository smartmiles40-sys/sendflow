// Recalcula a pontuação de TODA a base uma vez por dia.
//
// A nota sobe na hora (gatilho no banco a cada abertura/clique — 0023), mas só DESCE
// quando alguém recalcula: o clique de 91 dias atrás sai da janela sem que nada
// aconteça no contato. Sem esta passada diária, a pontuação só cresceria para sempre e
// "engajado" viraria "algum dia engajou". Mora no tick pelo mesmo motivo do refill das
// recorrentes: agendador separado já morreu calado uma vez.

import type { SupabaseClient } from '@supabase/supabase-js';

const INTERVALO_MS = 24 * 60 * 60 * 1000;

export async function recalcularScoreSePreciso(supabase: SupabaseClient, agora: Date): Promise<number | null> {
  const { data } = await supabase.from('app_settings').select('valor').eq('chave', 'score_recalculo').maybeSingle();
  const ultimo = Date.parse(String((data?.valor as { em?: string } | null)?.em ?? ''));
  if (Number.isFinite(ultimo) && agora.getTime() - ultimo < INTERVALO_MS) return null;

  // Marca ANTES de rodar: dois ticks simultâneos não recalculam a base em dobro.
  await supabase
    .from('app_settings')
    .upsert({ chave: 'score_recalculo', valor: { em: agora.toISOString() } }, { onConflict: 'chave' });
  const { data: n, error } = await supabase.rpc('sf_recalcular_score', { p_contact: null });
  if (error) throw new Error(error.message);
  return Number(n ?? 0);
}
