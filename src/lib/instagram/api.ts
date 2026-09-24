// Cliente da API do Instagram (Instagram API with Instagram Login — graph.instagram.com).
//
// Cada conta conectada tem o SEU token no Vault (sf_ig_token, 0025). Cache curto pelo
// mesmo motivo do cloud.ts: um post que viraliza manda dezenas de comentários por
// minuto, e cada resposta não pode ir ao Vault.

export const IG_GRAPH = 'https://graph.instagram.com';
export const IG_VERSAO = 'v23.0';

export class IgError extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: number | null = null,
  ) {
    super(mensagem);
    this.name = 'IgError';
  }
}

const cacheToken = new Map<string, { token: string | null; ate: number }>();

export async function tokenDaConta(igUserId: string): Promise<string | null> {
  const g = cacheToken.get(igUserId);
  if (g && g.ate > Date.now()) return g.token;
  let token: string | null = null;
  try {
    const { createServerClient } = await import('../supabase/server');
    const { data } = await createServerClient().rpc('sf_ig_token', { p_ig_user_id: igUserId });
    token = typeof data === 'string' && data ? data : null;
  } catch {
    token = null;
  }
  cacheToken.set(igUserId, { token, ate: Date.now() + 60_000 });
  return token;
}

export function esquecerTokenIg(igUserId?: string): void {
  if (igUserId) cacheToken.delete(igUserId);
  else cacheToken.clear();
}

/** Mensagens da Meta traduzidas para o que a equipe consegue agir. */
function traduzir(codigo: number | null, sub: number | null, msg: string): string {
  if (codigo === 190) return 'O token do Instagram expirou ou foi revogado — conecte a conta de novo.';
  if (codigo === 10 || codigo === 200) return `Permissão negada pela Meta (${msg}). Confira as permissões do app e se a conta é tester dele.`;
  if (codigo === 100 && /window/i.test(msg)) return 'Fora da janela de 24 h: a pessoa precisa mandar mensagem primeiro.';
  if (codigo === 10 && sub === 2534022) return 'Fora da janela de 24 h: a pessoa precisa mandar mensagem primeiro.';
  if (codigo === 551) return 'Essa pessoa não pode receber mensagens desta conta agora.';
  return msg;
}

export async function ig<T = unknown>(
  caminho: string,
  init: { method?: string; body?: unknown; token?: string | null; conta?: string | null; timeoutMs?: number } = {},
): Promise<T> {
  const token = init.token ?? (init.conta ? await tokenDaConta(init.conta) : null);
  if (!token) throw new IgError('Conta do Instagram sem token — conecte de novo.', 401);
  const url = caminho.startsWith('http') ? caminho : `${IG_GRAPH}/${IG_VERSAO}${caminho}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
      cache: 'no-store',
    });
  } catch {
    throw new IgError('Não consegui falar com o Instagram.', 0);
  }
  const corpo = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!res.ok || corpo.error) {
    const e = corpo.error ?? {};
    throw new IgError(traduzir(e.code ?? null, e.error_subcode ?? null, e.message ?? `erro ${res.status}`), res.status, e.code ?? null);
  }
  return corpo;
}
