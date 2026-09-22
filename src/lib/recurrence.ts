import type { Recorrencia } from './types';
import type { CampaignRow } from './campaign-row';

// America/Sao_Paulo é fixo em UTC−03:00 (sem horário de verão desde 2019), mesma
// premissa de sequence.ts e format.ts.
const SP_OFFSET = '-03:00';
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Rótulos pt-BR indexados por Date#getDay() (0 = domingo), para UI e descrições. */
export const DIAS_SEMANA_LABEL = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

/** Data de calendário em São Paulo de um instante UTC, como {y, m, d, dow}. */
function spCalendar(ms: number): { y: number; m: number; d: number; dow: number } {
  // Desloca o instante para "UTC fingindo ser SP" e lê com getUTC*: assim a
  // data/dia-da-semana são os de São Paulo, sem depender do fuso do ambiente.
  const shifted = new Date(ms - SP_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** {y,m,d} deslocado por deltaDays → 'YYYY-MM-DD' (aritmética pura em Date.UTC). */
function shiftYMD(y: number, m: number, d: number, deltaDays: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Próximas `semanas` ocorrências semanais (ISO UTC), estritamente após `desdeISO`.
 *
 * @param diaSemana 0 = domingo … 6 = sábado (mesma indexação de Date#getDay()).
 * @param hora      'HH:MM' no relógio de São Paulo.
 */
export function nextOccurrences(
  diaSemana: number,
  hora: string,
  desdeISO: string,
  semanas: number,
): string[] {
  if (semanas <= 0) return [];
  const desdeMs = new Date(desdeISO).getTime();
  const { y, m, d, dow } = spCalendar(desdeMs);

  // Dias até o próximo dia-da-semana alvo (0 = hoje mesmo).
  const delta = (diaSemana - dow + 7) % 7;
  let first = new Date(`${shiftYMD(y, m, d, delta)}T${hora}:00${SP_OFFSET}`).getTime();
  // A ocorrência de hoje só vale se ainda estiver no futuro — o cron não reprocessa
  // horários vencidos, então agendar no passado (ou no instante exato) seria um envio perdido.
  if (first <= desdeMs) first += 7 * DAY_MS;

  const out: string[] = [];
  for (let i = 0; i < semanas; i++) {
    out.push(new Date(first + i * 7 * DAY_MS).toISOString());
  }
  return out;
}

/** Linha de campanha `agendada` para uma ocorrência do molde. */
export function buildRecorrenciaRow(
  rec: Recorrencia,
  enviarEmISO: string,
): CampaignRow & { recorrencia_id: string } {
  const { m, d } = spCalendar(new Date(enviarEmISO).getTime());
  return {
    nome: `${rec.nome} — ${pad(d)}/${pad(m)}`,
    tipo: rec.tipo,
    categoria: rec.categoria,
    mensagem: rec.mensagem,
    midia_url: rec.midia_url ?? null,
    mencionar_todos: Boolean(rec.mencionar_todos),
    audience_id: rec.audience_id ?? null,
    group_ids: rec.group_ids && rec.group_ids.length ? rec.group_ids : null,
    // Recorrência é sempre para grupos: o molde semanal nasceu do caso "comunidade toda
    // segunda" e não tem tela para escolher lista de contatos.
    alvo: 'grupos',
    list_ids: null,
    connection_id: rec.connection_id ?? null,
    // Campanha de grupo não usa template: quem envia é o chip, com texto livre.
    template_nome: null,
    template_idioma: null,
    template_variaveis: null,
    template_cabecalho_url: null,
    enviar_em: enviarEmISO,
    status: 'agendada',
    recorrencia_id: rec.id,
  };
}

/** 'Toda segunda-feira às 09:00' / 'Todo domingo às 19:30'. */
export function describeRecorrencia(diaSemana: number, hora: string): string {
  const dia = DIAS_SEMANA_LABEL[diaSemana] ?? '?';
  // 'domingo' e 'sábado' são masculinos; os '-feira' são femininos.
  const artigo = dia.endsWith('-feira') ? 'Toda' : 'Todo';
  return `${artigo} ${dia} às ${hora}`;
}
