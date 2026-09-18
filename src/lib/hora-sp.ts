// Data e hora "de parede" em São Paulo, independentes do fuso de quem abre a tela.
// A equipe digita "20/09 às 20h" pensando no Brasil; se alguém abrir o painel de fora
// (ou o navegador estiver com fuso errado), a mensagem continua saindo às 20h de SP.

const PARTES = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** ISO → { data: 'YYYY-MM-DD', hora: 'HH:MM' } no relógio de São Paulo. */
export function partesSP(iso: string): { data: string; hora: string } {
  const p = PARTES.formatToParts(new Date(iso));
  const v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? '';
  return { data: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
}

/** 'YYYY-MM-DD' + 'HH:MM' de São Paulo → ISO UTC. Nulo se faltar ou for inválido. */
export function isoDeSP(data: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  // SP está fixo em UTC−3 desde 2019 (sem horário de verão).
  const d = new Date(`${data}T${hora}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const DIA_LONGO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});

/** "sábado, 19 de setembro" — cabeçalho de cada dia no desenho da cadência. */
export function diaPorExtenso(iso: string): string {
  return DIA_LONGO.format(new Date(iso));
}

/** Soma dias a um ISO mantendo a hora de parede (SP não tem horário de verão). */
export function somarDias(iso: string, dias: number): string {
  return new Date(new Date(iso).getTime() + dias * 86_400_000).toISOString();
}
