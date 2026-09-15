// O ritmo do disparo — a parte pura do anti-bloqueio.
//
// Mandar 80 mensagens em rajada é a receita para o número ser derrubado. O Z-API era
// protegido por um `wait` aleatório dentro do n8n; aqui a mesma ideia vira estado no
// banco (`connections.proximo_envio_em`), porque cada tick do motor é um processo novo
// e não lembra do anterior. Guardar "a partir de quando esta conexão pode voltar a
// enviar" é o que faz o intervalo sobreviver entre invocações.

/** Sorteia o intervalo, em milissegundos, entre uma mensagem e a próxima. */
export function sortearIntervaloMs(
  minSeg: number,
  maxSeg: number,
  aleatorio: number = Math.random(),
): number {
  const min = Math.max(0, Math.floor(minSeg));
  const max = Math.max(min, Math.floor(maxSeg));
  const faixa = max - min + 1;
  // Trava o sorteio em [0,1) para um aleatorio=1 vindo de teste não estourar a faixa.
  const r = Math.min(Math.max(aleatorio, 0), 0.999999);
  return (min + Math.floor(r * faixa)) * 1000;
}

/** Quando esta conexão pode enviar de novo, em ISO. */
export function proximoEnvio(
  agora: Date,
  minSeg: number,
  maxSeg: number,
  aleatorio?: number,
): string {
  return new Date(agora.getTime() + sortearIntervaloMs(minSeg, maxSeg, aleatorio)).toISOString();
}

/** A conexão está liberada para enviar agora? */
export function liberadaEm(proximoEnvioEm: string | null, agora: Date): boolean {
  if (!proximoEnvioEm) return true;
  const t = new Date(proximoEnvioEm).getTime();
  return Number.isNaN(t) || t <= agora.getTime();
}

/**
 * Início do dia em São Paulo, para contar o limite diário.
 * America/Sao_Paulo é fixo em UTC−03:00 desde 2019 (sem horário de verão) — a mesma
 * premissa que `format.ts`, `sequence.ts` e `recurrence.ts` já assumem no projeto.
 */
export function inicioDoDiaSP(agora: Date): string {
  const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
  const deslocado = new Date(agora.getTime() - SP_OFFSET_MS);
  const meiaNoiteSP = Date.UTC(
    deslocado.getUTCFullYear(),
    deslocado.getUTCMonth(),
    deslocado.getUTCDate(),
  );
  return new Date(meiaNoiteSP + SP_OFFSET_MS).toISOString();
}

/** Quanto ainda cabe hoje nesta conexão. `limite = 0` significa sem teto. */
export function saldoDiario(limite: number, enviadasHoje: number): number {
  if (!limite || limite <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, limite - enviadasHoje);
}

/**
 * Janela de envio: das 08h às 21h, por exemplo. Serve para o disparo não acordar
 * ninguém às 3 da manhã por causa de um agendamento errado.
 * `fim` menor que `inicio` significa uma janela que cruza a meia-noite (22h → 06h).
 */
export function dentroDaJanela(agora: Date, inicio: string, fim: string): boolean {
  const minutosAgora = minutosSP(agora);
  const i = hhmmParaMinutos(inicio);
  const f = hhmmParaMinutos(fim);
  if (i === null || f === null) return true;
  return i <= f ? minutosAgora >= i && minutosAgora <= f : minutosAgora >= i || minutosAgora <= f;
}

function minutosSP(agora: Date): number {
  const deslocado = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return deslocado.getUTCHours() * 60 + deslocado.getUTCMinutes();
}

function hhmmParaMinutos(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Pausa. Usada entre mensagens da mesma conexão dentro de um mesmo tick. */
export function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Orçamento de tempo de um tick. A hospedagem corta a função em algum ponto
 * (60s no plano padrão da Vercel), então o motor precisa saber parar sozinho,
 * com a fila num estado consistente, e deixar o resto para o tick seguinte.
 */
export class Orcamento {
  private readonly fim: number;
  constructor(ms: number, inicio: number = Date.now()) {
    this.fim = inicio + ms;
  }
  restanteMs(): number {
    return this.fim - Date.now();
  }
  /** Ainda dá tempo de mais uma operação que leva `custoMs`? */
  cabe(custoMs: number): boolean {
    return this.restanteMs() > custoMs;
  }
}
