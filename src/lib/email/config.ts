// A conexão do Resend — guardada no SendFlow, com as variáveis de ambiente de reserva.
//
// Desde a 0022 a tela E-mail → Conexão guarda a chave da API e o segredo do webhook
// no Vault, e o domínio escolhido em `app_settings.email_resend`. A chave precisa ser
// de ACESSO TOTAL: é com ela que o SendFlow cadastra o domínio, lê os registros de DNS
// e cria o webhook sozinho — o "conectar em 1 clique" que a pessoa espera.
//
// Cache curto pelo mesmo motivo do meta-config: o worker manda dezenas de e-mails por
// tick e o webhook do Resend chega em rajada.

const API = 'https://api.resend.com';

export interface ConfigEmail {
  resendKey: string | null;
  resendWebhookSecret: string | null;
  dominio: string | null;
  dominioId: string | null;
  webhookId: string | null;
  smtp: boolean;
}

interface ValorResend {
  dominio?: string | null;
  dominio_id?: string | null;
  webhook_id?: string | null;
}

const env = (k: string) => (process.env[k] ?? '').trim() || null;

let cache: { v: ConfigEmail; ate: number } | null = null;

export function esquecerConfigEmail(): void {
  cache = null;
}

async function supabase() {
  // Import tardio: provider.ts (e os testes dele) não precisam carregar o cliente do banco.
  const { createServerClient } = await import('../supabase/server');
  return createServerClient();
}

async function lerValor(): Promise<ValorResend> {
  const { data } = await (await supabase())
    .from('app_settings')
    .select('valor')
    .eq('chave', 'email_resend')
    .maybeSingle();
  return (data?.valor ?? {}) as ValorResend;
}

async function gravarValor(v: ValorResend): Promise<string | null> {
  const { error } = await (await supabase())
    .from('app_settings')
    .upsert({ chave: 'email_resend', valor: v }, { onConflict: 'chave' });
  return error ? error.message : null;
}

async function segredo(nome: 'resend_api_key' | 'resend_webhook_secret'): Promise<string | null> {
  const { data } = await (await supabase()).rpc('sf_cfg_segredo', { p_nome: nome });
  return typeof data === 'string' && data ? data : null;
}

async function guardarSegredo(nome: 'resend_api_key' | 'resend_webhook_secret', valor: string): Promise<string | null> {
  const { error } = await (await supabase()).rpc('sf_cfg_guardar_segredo', { p_nome: nome, p_valor: valor });
  return error ? error.message : null;
}

export async function lerConfigEmail(): Promise<ConfigEmail> {
  if (cache && cache.ate > Date.now()) return cache.v;
  let valor: ValorResend = {};
  let chave: string | null = null;
  let segredoWebhook: string | null = null;
  try {
    [valor, chave, segredoWebhook] = await Promise.all([
      lerValor(),
      segredo('resend_api_key'),
      segredo('resend_webhook_secret'),
    ]);
  } catch {
    // Banco fora do ar: segue com o que houver no ambiente.
  }
  const v: ConfigEmail = {
    resendKey: chave || env('RESEND_API_KEY'),
    resendWebhookSecret: segredoWebhook || env('RESEND_WEBHOOK_SECRET'),
    dominio: valor.dominio ?? null,
    dominioId: valor.dominio_id ?? null,
    webhookId: valor.webhook_id ?? null,
    smtp: Boolean(env('SMTP_HOST') && env('SMTP_USER')),
  };
  cache = { v, ate: Date.now() + 30_000 };
  return v;
}

// ── API do Resend ────────────────────────────────────────────────────────────────

export class ResendApiError extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
    this.name = 'ResendApiError';
  }
}

async function resend<T>(chave: string, caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${caminho}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch {
    throw new ResendApiError('Não consegui falar com o Resend. Tente de novo.', 0);
  }
  const corpo = (await res.json().catch(() => ({}))) as T & { message?: string; name?: string };
  if (!res.ok) {
    if (corpo.name === 'restricted_api_key') {
      throw new ResendApiError(
        'Essa chave só tem permissão de ENVIO. Crie uma com "Full access" no Resend (API Keys → Create) — é com ela que o SendFlow configura o domínio e o webhook.',
        res.status,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ResendApiError('O Resend recusou a chave. Confira se copiou inteira (começa com re_).', res.status);
    }
    throw new ResendApiError(`Resend ${res.status}: ${corpo.message ?? corpo.name ?? 'erro sem detalhe'}`, res.status);
  }
  return corpo;
}

export interface RegistroDns {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string | number;
  priority?: number;
  status: string;
}

export interface DominioResend {
  id: string;
  name: string;
  status: string;
  records?: RegistroDns[];
}

async function chaveOuErro(): Promise<string> {
  const c = (await lerConfigEmail()).resendKey;
  if (!c) throw new ResendApiError('Conecte o Resend primeiro (cole a chave da API).', 400);
  return c;
}

/** Confere a chave e guarda no cofre. Devolve os domínios que ela enxerga. */
export async function conectarResend(chave: string): Promise<{ dominios: DominioResend[] }> {
  const k = String(chave ?? '').trim();
  if (!/^re_[A-Za-z0-9_]{16,}$/.test(k)) {
    throw new ResendApiError('A chave do Resend começa com re_ e não tem espaços.', 400);
  }
  const lista = await resend<{ data?: DominioResend[] }>(k, '/domains');
  const erro = await guardarSegredo('resend_api_key', k);
  if (erro) throw new ResendApiError(`Não consegui guardar a chave no cofre: ${erro}`, 500);
  esquecerConfigEmail();
  return { dominios: lista.data ?? [] };
}

export async function desconectarResend(): Promise<void> {
  const db = await supabase();
  await db.rpc('sf_cfg_apagar_segredo', { p_nome: 'resend_api_key' });
  await db.rpc('sf_cfg_apagar_segredo', { p_nome: 'resend_webhook_secret' });
  await gravarValor({});
  esquecerConfigEmail();
}

export async function listarDominios(): Promise<DominioResend[]> {
  const r = await resend<{ data?: DominioResend[] }>(await chaveOuErro(), '/domains');
  return r.data ?? [];
}

export async function lerDominio(id: string): Promise<DominioResend> {
  return resend<DominioResend>(await chaveOuErro(), `/domains/${encodeURIComponent(id)}`);
}

/** Usa um domínio que já existe no Resend ou cadastra um novo (e devolve os registros de DNS). */
export async function escolherDominio(nome: string): Promise<DominioResend> {
  const alvo = String(nome ?? '').trim().toLowerCase();
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(alvo)) {
    throw new ResendApiError('Digite só o domínio, sem http e sem @ (ex.: mail.suaempresa.com.br).', 400);
  }
  const chave = await chaveOuErro();
  const existentes = (await resend<{ data?: DominioResend[] }>(chave, '/domains')).data ?? [];
  const achado = existentes.find((d) => d.name.toLowerCase() === alvo);
  const dominio = achado
    ? await resend<DominioResend>(chave, `/domains/${achado.id}`)
    : await resend<DominioResend>(chave, '/domains', { method: 'POST', body: { name: alvo } });
  const atual = await lerValor();
  await gravarValor({ ...atual, dominio: dominio.name, dominio_id: dominio.id });
  esquecerConfigEmail();
  return dominio;
}

/** Pede ao Resend para conferir o DNS agora (em vez de esperar a checagem automática). */
export async function verificarDominio(): Promise<DominioResend> {
  const cfg = await lerConfigEmail();
  if (!cfg.dominioId) throw new ResendApiError('Escolha o domínio primeiro.', 400);
  const chave = await chaveOuErro();
  await resend(chave, `/domains/${cfg.dominioId}/verify`, { method: 'POST' }).catch(() => null);
  return resend<DominioResend>(chave, `/domains/${cfg.dominioId}`);
}

export const EVENTOS_WEBHOOK = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
] as const;

/**
 * Cria o webhook no Resend apontando para o SendFlow e guarda o segredo de assinatura.
 * Sem ele não chegam entregue/bounce/spam — e bounce não tratado derruba a reputação do
 * domínio em silêncio.
 */
export async function criarWebhook(url: string): Promise<{ id: string }> {
  if (!url.startsWith('https://')) {
    throw new ResendApiError(`O endereço público do SendFlow não é https (${url}). Defina APP_URL.`, 400);
  }
  const chave = await chaveOuErro();
  const r = await resend<{ id?: string; signing_secret?: string }>(chave, '/webhooks', {
    method: 'POST',
    body: { endpoint: url, events: EVENTOS_WEBHOOK },
  });
  if (!r.id || !r.signing_secret) {
    throw new ResendApiError(
      'O Resend criou o webhook mas não devolveu o segredo. Copie o "Signing secret" dele no painel do Resend e cole aqui.',
      502,
    );
  }
  const erro = await guardarSegredo('resend_webhook_secret', r.signing_secret);
  if (erro) throw new ResendApiError(`Não consegui guardar o segredo do webhook: ${erro}`, 500);
  const atual = await lerValor();
  await gravarValor({ ...atual, webhook_id: r.id });
  esquecerConfigEmail();
  return { id: r.id };
}

/** Caminho manual: o segredo copiado do painel do Resend (começa com whsec_). */
export async function guardarSegredoWebhook(segredoColado: string): Promise<void> {
  const s = String(segredoColado ?? '').trim();
  if (!/^whsec_[A-Za-z0-9+/=]{16,}$/.test(s)) {
    throw new ResendApiError('O segredo do webhook do Resend começa com whsec_.', 400);
  }
  const erro = await guardarSegredo('resend_webhook_secret', s);
  if (erro) throw new ResendApiError(`Não consegui guardar o segredo: ${erro}`, 500);
  esquecerConfigEmail();
}
