// Cálculos e formatações de KPI compartilhados entre a API e a tela.
//
// A régua está aqui, num lugar só, porque "taxa de abertura" definida de dois jeitos
// diferentes em dois arquivos é como um painel perde a confiança da equipe.

/** Data de calendário em São Paulo (`YYYY-MM-DD`) de um instante. */
export function diaSP(data: Date): string {
  // America/Sao_Paulo é fixo em UTC−03:00 desde 2019 — mesma premissa do resto do projeto.
  const deslocado = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${deslocado.getUTCFullYear()}-${pad(deslocado.getUTCMonth() + 1)}-${pad(deslocado.getUTCDate())}`;
}

export function diasAtras(data: Date, dias: number): Date {
  return new Date(data.getTime() - dias * 24 * 60 * 60 * 1000);
}

/**
 * Percentual 0–100 com uma casa. Devolve `null` quando o denominador é zero.
 *
 * Zero e "não dá para dizer" são coisas diferentes: uma campanha recém-disparada com
 * 0% de abertura assusta; "—" porque ninguém recebeu ainda, não.
 */
export function taxa(parte: number, todo: number): number | null {
  if (!todo || todo <= 0) return null;
  return Math.round((parte / todo) * 1000) / 10;
}

/** `45.7` → `"45,7%"`; `null` → `"—"`. Vírgula decimal, que é como se lê em português. */
export function formatarTaxa(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return `${String(valor).replace('.', ',')}%`;
}

/** `1234` → `"1.234"`. Separador de milhar brasileiro. */
export function formatarNumero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return new Intl.NumberFormat('pt-BR').format(valor);
}

/** Segundos → duração curta e legível: `42s`, `7min`, `3h 12min`, `2d 4h`. */
export function formatarDuracao(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || Number.isNaN(segundos)) return '—';
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  if (h < 24) return restoMin ? `${h}h ${restoMin}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const restoH = h % 24;
  return restoH ? `${d}d ${restoH}h` : `${d}d`;
}

/**
 * Referências de mercado para e-mail marketing, para o número sozinho dizer alguma coisa.
 *
 * "Taxa de abertura: 31%" não significa nada para quem não vive de marketing — é bom ou
 * ruim? As faixas abaixo são as medianas normalmente reportadas em levantamentos de
 * mercado (Mailchimp, Campaign Monitor) e servem para ORIENTAR, não para cravar: uma
 * lista pequena e muito engajada passa fácil de 50% de abertura, e uma base comprada
 * não chega a 5%.
 */
export const REFERENCIAS = {
  email_abertura: { ruim: 15, ok: 25, bom: 35 },
  email_clique: { ruim: 1.5, ok: 2.5, bom: 5 },
  email_ctor: { ruim: 6, ok: 10, bom: 15 },
  email_bounce: { ruim: 5, ok: 2, bom: 0.5, menorEhMelhor: true },
  email_spam: { ruim: 0.3, ok: 0.1, bom: 0.02, menorEhMelhor: true },
  // WhatsApp não tem referência pública confiável; estes são os patamares que fazem
  // sentido para o canal: entrega quase perfeita, leitura alta, resposta rara.
  whatsapp_entrega: { ruim: 85, ok: 95, bom: 98 },
  whatsapp_leitura: { ruim: 40, ok: 60, bom: 80 },
  whatsapp_resposta: { ruim: 1, ok: 3, bom: 8 },
} as const;

export type Veredicto = 'ruim' | 'atencao' | 'ok' | 'bom' | 'indefinido';

/** Onde este número cai em relação à referência. Alimenta a cor do indicador na tela. */
export function avaliar(
  valor: number | null | undefined,
  referencia: { ruim: number; ok: number; bom: number; menorEhMelhor?: boolean },
): Veredicto {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return 'indefinido';
  if (referencia.menorEhMelhor) {
    if (valor <= referencia.bom) return 'bom';
    if (valor <= referencia.ok) return 'ok';
    if (valor <= referencia.ruim) return 'atencao';
    return 'ruim';
  }
  if (valor >= referencia.bom) return 'bom';
  if (valor >= referencia.ok) return 'ok';
  if (valor >= referencia.ruim) return 'atencao';
  return 'ruim';
}

/**
 * Frase curta explicando o que fazer com o número. É o que separa um painel que
 * informa de um painel que ajuda — ainda mais para quem não é de marketing.
 */
export function conselho(metrica: keyof typeof REFERENCIAS, veredicto: Veredicto): string | null {
  if (veredicto === 'indefinido' || veredicto === 'bom') return null;
  const mapa: Record<keyof typeof REFERENCIAS, string> = {
    email_abertura:
      'Quem decide a abertura é o ASSUNTO (e o remetente). Teste um assunto B mais curto e específico — a campanha tem teste A/B embutido.',
    email_clique:
      'Abriram, mas não clicaram: o conteúdo não pediu uma ação clara. Use um botão só, com um verbo, acima da dobra.',
    email_ctor:
      'A relação entre quem abriu e quem clicou está baixa: o e-mail entrega menos do que o assunto promete.',
    email_bounce:
      'Bounce alto queima a reputação do domínio. A base provavelmente tem endereços velhos ou digitados errado — o sistema já descadastra os que voltam.',
    email_spam:
      'Denúncia de spam é o pior sinal que existe. Reduza a frequência e confira se essas pessoas realmente pediram para receber.',
    whatsapp_entrega:
      'Entrega baixa costuma ser número inválido na lista ou o WhatsApp da conexão instável. Confira a aba Conexões.',
    whatsapp_leitura:
      'Mensagem entregue e não lida é grupo saturado ou horário ruim. Compare os horários no painel e corte os grupos sem leitura.',
    whatsapp_resposta:
      'Poucas respostas: a mensagem não faz uma pergunta. Terminar com uma pergunta simples costuma multiplicar esse número.',
  };
  return mapa[metrica] ?? null;
}
