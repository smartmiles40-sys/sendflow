import type { SupabaseClient } from '@supabase/supabase-js';
import type { Recorrencia } from './types';
import { buildRecorrenciaRow, nextOccurrences } from './recurrence';

/** Quantas ocorrências ficam materializadas à frente. Refill diário mantém a janela cheia. */
export const HORIZONTE_SEMANAS = 6;

/** Campos de conteúdo que o molde manda nas ocorrências futuras ainda não enviadas. */
const CAMPOS_SINCRONIZADOS = [
  'nome',
  'tipo',
  'categoria',
  'mensagem',
  'midia_url',
  'mencionar_todos',
  'audience_id',
  'group_ids',
  'connection_id',
] as const;

/** Normaliza o timestamptz do PostgREST ('…+00:00') para o ISO com Z que geramos. */
function isoZ(v: string): string {
  return new Date(v).toISOString();
}

/**
 * Cria as campanhas que faltam para uma recorrência dentro do horizonte.
 * Idempotente: o índice único (recorrencia_id, enviar_em) descarta o que já existe,
 * inclusive ocorrências que o usuário cancelou na mão (não são ressuscitadas).
 */
export async function refillRecorrencia(
  supabase: SupabaseClient,
  rec: Recorrencia,
  now: Date = new Date(),
): Promise<{ criadas: number; error: string | null }> {
  if (!rec.ativo) return { criadas: 0, error: null };

  const ocorrencias = nextOccurrences(
    rec.dia_semana,
    rec.hora,
    now.toISOString(),
    HORIZONTE_SEMANAS,
  );
  if (!ocorrencias.length) return { criadas: 0, error: null };

  const rows = ocorrencias.map((iso) => buildRecorrenciaRow(rec, iso));
  const { data, error } = await supabase
    .from('campaigns')
    .upsert(rows, { onConflict: 'recorrencia_id,enviar_em', ignoreDuplicates: true })
    .select('id');
  if (error) return { criadas: 0, error: error.message };
  return { criadas: data?.length ?? 0, error: null };
}

/** Refill de todas as recorrências ativas. */
export async function refillTodas(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{
  criadas: number;
  porRecorrencia: { id: string; nome: string; criadas: number }[];
  error: string | null;
}> {
  const { data, error } = await supabase.from('recorrencias').select('*').eq('ativo', true);
  if (error) return { criadas: 0, porRecorrencia: [], error: error.message };

  const porRecorrencia: { id: string; nome: string; criadas: number }[] = [];
  let criadas = 0;
  for (const rec of (data ?? []) as Recorrencia[]) {
    const r = await refillRecorrencia(supabase, rec, now);
    if (r.error) return { criadas, porRecorrencia, error: r.error };
    criadas += r.criadas;
    porRecorrencia.push({ id: rec.id, nome: rec.nome, criadas: r.criadas });
  }
  return { criadas, porRecorrencia, error: null };
}

/** Cancela as ocorrências futuras ainda `agendada` de uma recorrência. */
export async function cancelarFuturas(
  supabase: SupabaseClient,
  recorrenciaId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const { error } = await supabase
    .from('campaigns')
    .update({ status: 'cancelada' })
    .eq('recorrencia_id', recorrenciaId)
    .eq('status', 'agendada')
    .gt('enviar_em', now.toISOString());
  return error ? error.message : null;
}

/**
 * Alinha as ocorrências futuras ao molde depois de uma edição:
 * o que saiu da grade (dia/hora mudaram) é cancelado, o que continua na grade tem o
 * conteúdo reescrito, e o refill cria o que passou a faltar. Campanhas já enviadas,
 * enviando ou canceladas na mão nunca são tocadas.
 */
export async function sincronizarFuturas(
  supabase: SupabaseClient,
  rec: Recorrencia,
  now: Date = new Date(),
): Promise<{ criadas: number; error: string | null }> {
  if (!rec.ativo) {
    const error = await cancelarFuturas(supabase, rec.id, now);
    return { criadas: 0, error };
  }

  const grade = nextOccurrences(rec.dia_semana, rec.hora, now.toISOString(), HORIZONTE_SEMANAS);
  const gradeSet = new Set(grade);

  const { data: futuras, error: readErr } = await supabase
    .from('campaigns')
    .select('id,enviar_em')
    .eq('recorrencia_id', rec.id)
    .eq('status', 'agendada')
    .gt('enviar_em', now.toISOString());
  if (readErr) return { criadas: 0, error: readErr.message };

  for (const c of (futuras ?? []) as { id: string; enviar_em: string }[]) {
    const iso = isoZ(c.enviar_em);
    if (gradeSet.has(iso)) {
      // Continua valendo: reescreve o conteúdo a partir do molde (nome inclui a data).
      const row = buildRecorrenciaRow(rec, iso);
      const patch = Object.fromEntries(CAMPOS_SINCRONIZADOS.map((k) => [k, row[k]]));
      const { error } = await supabase.from('campaigns').update(patch).eq('id', c.id);
      if (error) return { criadas: 0, error: error.message };
    } else {
      const { error } = await supabase
        .from('campaigns')
        .update({ status: 'cancelada' })
        .eq('id', c.id);
      if (error) return { criadas: 0, error: error.message };
    }
  }

  return refillRecorrencia(supabase, rec, now);
}
