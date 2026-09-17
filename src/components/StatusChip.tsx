import type { CampaignStatus } from '@/lib/types';

type ChipStyle = { label: string; cls: string; dot: string; pulse?: boolean };

// Colours mirror the approved agenda mockup: each status is a soft-tinted pill
// with a leading dot in the accent colour. "enviando" pulses to read as live.
const map: Record<CampaignStatus, ChipStyle> = {
  rascunho: { label: 'Rascunho', cls: 'bg-muted/15 text-[#C9DCD8]', dot: 'bg-muted' },
  agendada: { label: 'Agendada', cls: 'bg-blue2/15 text-[#DFEFC5]', dot: 'bg-blue2' },
  enviando: { label: 'Enviando…', cls: 'bg-orange/15 text-[#ffb183]', dot: 'bg-orange', pulse: true },
  enviada: { label: 'Enviada', cls: 'bg-green/10 text-[#D7F264]', dot: 'bg-green' },
  cancelada: { label: 'Cancelada', cls: 'bg-muted/15 text-muted', dot: 'bg-muted' },
  erro: { label: 'Erro', cls: 'bg-orange/15 text-[#ffb183]', dot: 'bg-orange' },
};

export function StatusChip({ status, detail }: { status: CampaignStatus; detail?: string }) {
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}
    >
      <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${s.dot} ${s.pulse ? 'animate-chip-pulse' : ''}`} />
      {s.label}
      {detail ? <span className="tabular-nums">{detail}</span> : null}
    </span>
  );
}
