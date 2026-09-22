// Entrega do e-mail. Dois caminhos, uma interface só.
//
//   RESEND — API HTTP, sem dependência, e com webhook nativo de entregue/bounce/spam.
//            É o caminho recomendado: os KPIs de ENTREGA vêm do provedor, não de chute.
//   SMTP   — qualquer caixa que a empresa já pague (Hostinger, Zoho, Gmail, Brevo).
//            Abertura e clique continuam funcionando (são nossos, via pixel e link),
//            mas "entregue" vira uma inferência: SMTP aceito ≠ caixa de entrada.
//
// A escolha é por variável de ambiente. Nenhuma linha de código muda ao trocar.

export interface EmailParaEnviar {
  para: string;
  paraNome?: string | null;
  de: string;
  deNome: string;
  responderPara?: string | null;
  assunto: string;
  html: string;
  texto: string;
  /** Vira o cabeçalho List-Unsubscribe — o botão "cancelar inscrição" do Gmail. */
  urlDescadastro?: string | null;
}

export interface ResultadoEmail {
  messageId: string | null;
  provedor: 'resend' | 'smtp';
}

export class EmailError extends Error {
  readonly permanente: boolean;
  readonly status: number;
  /**
   * Quanto o provedor pediu para esperar. Vem do cabeçalho `Retry-After` no 429.
   *
   * Existe porque o 429 já queimou uma fila inteira: sem respeitar a pausa, as três
   * tentativas de cada destinatário aconteciam em segundos, todas levavam 429, e a
   * campanha virava `falha` em bloco — por um limite que teria passado em meio minuto.
   */
  readonly esperarMs: number;
  constructor(mensagem: string, permanente = false, status = 0, esperarMs = 0) {
    super(mensagem);
    this.name = 'EmailError';
    this.permanente = permanente;
    this.status = status;
    this.esperarMs = esperarMs;
  }
}

export type Provedor = 'resend' | 'smtp';

/**
 * Qual provedor está configurado. `EMAIL_PROVIDER` decide quando os dois estão
 * disponíveis; sem ele, Resend ganha por ter melhor telemetria de entrega.
 */
export function provedorAtivo(): Provedor | null {
  const escolhido = (process.env.EMAIL_PROVIDER ?? '').trim().toLowerCase();
  const temResend = Boolean(process.env.RESEND_API_KEY);
  const temSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
  if (escolhido === 'resend') return temResend ? 'resend' : null;
  if (escolhido === 'smtp') return temSmtp ? 'smtp' : null;
  if (temResend) return 'resend';
  if (temSmtp) return 'smtp';
  return null;
}

/** Mensagem única de "falta configurar", reusada pela API e pela tela. */
export const AVISO_SEM_PROVEDOR =
  'Nenhum provedor de e-mail configurado. Defina RESEND_API_KEY ou as variáveis SMTP_* no ambiente.';

/** `Fulano <fulano@dominio.com>`, com aspas quando o nome tem vírgula ou ponto. */
export function formatarRemetente(nome: string, email: string): string {
  const limpo = String(nome ?? '').trim();
  if (!limpo) return email;
  const precisaAspas = /[",.<>:;@[\]]/.test(limpo);
  const seguro = limpo.replace(/"/g, "'");
  return precisaAspas ? `"${seguro}" <${email}>` : `${seguro} <${email}>`;
}

/**
 * Cabeçalhos de descadastro em um clique.
 *
 * Desde 2024 Gmail e Yahoo EXIGEM isso de quem manda volume. Sem eles, a entrega
 * degrada em silêncio — e o sintoma é "a taxa de abertura caiu", nunca uma mensagem de
 * erro. É o item mais barato desta base de código com maior impacto em entregabilidade.
 */
export function cabecalhosDescadastro(url?: string | null): Record<string, string> {
  if (!url) return {};
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// ── Resend ───────────────────────────────────────────────────────────────────────

async function enviarPorResend(msg: EmailParaEnviar): Promise<ResultadoEmail> {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) throw new EmailError(AVISO_SEM_PROVEDOR, true);

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: formatarRemetente(msg.deNome, msg.de),
        to: [msg.paraNome ? formatarRemetente(msg.paraNome, msg.para) : msg.para],
        subject: msg.assunto,
        html: msg.html,
        text: msg.texto,
        ...(msg.responderPara ? { reply_to: msg.responderPara } : {}),
        headers: cabecalhosDescadastro(msg.urlDescadastro),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new EmailError('Não foi possível falar com a API do Resend.', false);
  }

  const corpo = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok) {
    // 4xx (menos 429) é pedido errado: domínio não verificado, e-mail inválido.
    // Repetir não conserta — vira falha definitiva do destinatário.
    const permanente = res.status >= 400 && res.status < 500 && res.status !== 429;
    // O Resend manda `Retry-After` em segundos no 429. Quando não manda, 5 s é o
    // suficiente para o balde de tokens dele encher de novo (o limite é por segundo).
    const retryAfter = Number(res.headers.get('retry-after') ?? 0);
    const esperarMs =
      res.status === 429 ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5_000) : 0;
    throw new EmailError(
      `Resend ${res.status}: ${corpo.message ?? corpo.name ?? 'erro sem detalhe'}`,
      permanente,
      res.status,
      esperarMs,
    );
  }
  return { messageId: corpo.id ?? null, provedor: 'resend' };
}

// ── SMTP ─────────────────────────────────────────────────────────────────────────

// O transporte é caro de criar (handshake TLS) e o worker manda dezenas de e-mails por
// tick. Reaproveitar a mesma conexão entre eles é a diferença entre 25 envios e 3.
let transporteCache: import('nodemailer').Transporter | null = null;

async function transporteSmtp() {
  if (transporteCache) return transporteCache;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user) throw new EmailError(AVISO_SEM_PROVEDOR, true);

  const porta = Number(process.env.SMTP_PORT ?? 587);
  const nodemailer = await import('nodemailer');
  transporteCache = nodemailer.createTransport({
    host,
    port: porta,
    // 465 é TLS implícito; 587 abre em claro e sobe para TLS via STARTTLS.
    secure: porta === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });
  return transporteCache;
}

async function enviarPorSmtp(msg: EmailParaEnviar): Promise<ResultadoEmail> {
  const transporte = await transporteSmtp();
  try {
    const info = await transporte.sendMail({
      from: formatarRemetente(msg.deNome, msg.de),
      to: msg.paraNome ? formatarRemetente(msg.paraNome, msg.para) : msg.para,
      subject: msg.assunto,
      html: msg.html,
      text: msg.texto,
      replyTo: msg.responderPara ?? undefined,
      headers: cabecalhosDescadastro(msg.urlDescadastro),
    });
    return { messageId: info.messageId ?? null, provedor: 'smtp' };
  } catch (e) {
    const erro = e as { responseCode?: number; message?: string };
    // 5xx do SMTP é recusa definitiva (caixa não existe); 4xx é "tente mais tarde".
    const codigo = erro.responseCode ?? 0;
    throw new EmailError(
      `SMTP ${codigo || ''}: ${erro.message ?? 'erro sem detalhe'}`.trim(),
      codigo >= 500 && codigo < 600,
      codigo,
    );
  }
}

// ── Porta de entrada ─────────────────────────────────────────────────────────────

export async function enviarEmail(msg: EmailParaEnviar): Promise<ResultadoEmail> {
  const provedor = provedorAtivo();
  if (!provedor) throw new EmailError(AVISO_SEM_PROVEDOR, true);
  return provedor === 'resend' ? enviarPorResend(msg) : enviarPorSmtp(msg);
}

/** Confere se o SMTP aceita as credenciais, sem mandar e-mail. */
export async function testarConexaoSmtp(): Promise<{ ok: boolean; erro?: string }> {
  try {
    const transporte = await transporteSmtp();
    await transporte.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
