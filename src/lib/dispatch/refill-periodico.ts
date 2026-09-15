import type { SupabaseClient } from '@supabase/supabase-js';
import { refillTodas } from '../recorrencia-refill';

/** De quanto em quanto tempo as campanhas recorrentes são materializadas. */
const INTERVALO_HORAS = 6;
const CHAVE = 'ultimo_refill';

/**
 * Mantém a janela das campanhas recorrentes cheia, de dentro do próprio motor.
 *
 * Antes isso era um workflow separado no n8n, agendado uma vez por dia. Duas coisas
 * davam errado com frequência: o agendador externo morria calado (e ninguém percebia
 * até uma segunda-feira sem o disparo semanal), e "uma vez por dia" não se recupera de
 * um dia perdido.
 *
 * Aqui o controle é por CARIMBO, não por horário: a cada tick o motor olha quando foi
 * a última vez e refaz se passaram mais de 6 horas. Ficar 3 dias fora do ar e voltar
 * conserta sozinho no primeiro minuto — e o refill é idempotente, então rodar demais
 * não duplica nada.
 */
export async function refillSePreciso(
  supabase: SupabaseClient,
  agora: Date = new Date(),
): Promise<{ rodou: boolean; criadas: number }> {
  const { data } = await supabase
    .from('app_settings')
    .select('valor')
    .eq('chave', CHAVE)
    .maybeSingle();

  const ultimo = (data?.valor as { em?: string } | null)?.em;
  if (ultimo) {
    const horas = (agora.getTime() - new Date(ultimo).getTime()) / 3_600_000;
    if (Number.isFinite(horas) && horas < INTERVALO_HORAS) return { rodou: false, criadas: 0 };
  }

  // O carimbo é gravado ANTES de trabalhar: se dois ticks caírem juntos, o segundo já
  // vê o horário novo e não repete. O refill é idempotente de qualquer forma — isto
  // é só para não gastar consulta à toa.
  await supabase
    .from('app_settings')
    .upsert({ chave: CHAVE, valor: { em: agora.toISOString() } }, { onConflict: 'chave' });

  const r = await refillTodas(supabase, agora);
  return { rodou: true, criadas: r.criadas };
}
