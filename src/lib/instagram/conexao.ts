// Conectar a conta do Instagram — "igual ManyChat": um botão, login na tela do próprio
// Instagram, e o SendFlow faz o resto.
//
//   1. /api/instagram/conectar manda a pessoa para instagram.com/oauth/authorize com um
//      `state` ASSINADO (sem isso, qualquer site poderia plantar a conta de outra pessoa
//      no SendFlow — o CSRF clássico de OAuth);
//   2. a volta (/api/instagram/callback) troca o código por um token curto (1 h) e ele
//      por um LONGO (60 dias), lê o perfil e guarda o token no Vault;
//   3. assina a conta nos webhooks (subscribed_apps) — sem isso nenhum comentário chega;
//   4. o tick renova o token antes de vencer (renovarTokensInstagram).
//
// Os dados do app (ID e chave secreta do "Instagram app", que NÃO são os do app da
// Meta) moram em app_settings.instagram + Vault — a tela Instagram → Conexão guarda.

import { createServerClient } from '../supabase/server';
import { urlPublica } from '../url';
import { assinar, assinaturaConfere, tokenAleatorio } from '../seguranca';
import { lerConfigMeta } from '../whatsapp/meta-config';
import { esquecerTokenIg, ig, IgError, IG_GRAPH, IG_VERSAO } from './api';

export const ESCOPOS = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];

export const CAMPOS_WEBHOOK = ['messages', 'messaging_postbacks', 'comments', 'message_reactions', 'messaging_seen'];

export function urlDeRetorno(): string {
  return `${urlPublica()}/api/instagram/callback`;
}

export function urlDoWebhookIg(): string {
  return `${urlPublica()}/api/webhooks/instagram`;
}

// ── Dados do app ─────────────────────────────────────────────────────────────────

export interface ConfigInstagram {
  appId: string | null;
  appSecret: string | null;
}

let cache: { v: ConfigInstagram; ate: number } | null = null;

export async function lerConfigInstagram(): Promise<ConfigInstagram> {
  if (cache && cache.ate > Date.now()) return cache.v;
  const db = createServerClient();
  let appId: string | null = null;
  let appSecret: string | null = null;
  try {
    const [{ data: cfg }, { data: seg }] = await Promise.all([
      db.from('app_settings').select('valor').eq('chave', 'instagram').maybeSingle(),
      db.rpc('sf_cfg_segredo', { p_nome: 'instagram_app_secret' }),
    ]);
    appId = ((cfg?.valor ?? {}) as { app_id?: string }).app_id ?? null;
    appSecret = typeof seg === 'string' && seg ? seg : null;
  } catch {
    // banco fora: segue sem
  }
  const v = {
    appId: appId || (process.env.INSTAGRAM_APP_ID ?? '').trim() || null,
    appSecret: appSecret || (process.env.INSTAGRAM_APP_SECRET ?? '').trim() || null,
  };
  cache = { v, ate: Date.now() + 30_000 };
  return v;
}

export async function salvarConfigInstagram(p: { appId?: string; appSecret?: string }): Promise<{ ok: true } | { erro: string }> {
  const db = createServerClient();
  const appId = (p.appId ?? '').trim();
  const secret = (p.appSecret ?? '').trim();
  if (appId && !/^\d{5,25}$/.test(appId)) return { erro: 'O ID do app do Instagram tem só números.' };
  if (secret && !/^[A-Za-z0-9]{16,64}$/.test(secret)) return { erro: 'A chave secreta são letras e números, sem espaço.' };
  if (secret) {
    const { error } = await db.rpc('sf_cfg_guardar_segredo', { p_nome: 'instagram_app_secret', p_valor: secret });
    if (error) return { erro: `Não consegui guardar a chave no cofre: ${error.message}` };
  }
  if (p.appId !== undefined) {
    const { error } = await db
      .from('app_settings')
      .upsert({ chave: 'instagram', valor: { app_id: appId || null } }, { onConflict: 'chave' });
    if (error) return { erro: error.message };
  }
  cache = null;
  return { ok: true };
}

// ── state assinado (anti-CSRF) ───────────────────────────────────────────────────

export function criarState(agora = Date.now()): string {
  const base = `${agora}.${tokenAleatorio(12)}`;
  return `${base}.${assinar(`ig-oauth:${base}`)}`;
}

export function stateValido(state: string, agora = Date.now()): boolean {
  const partes = String(state ?? '').split('.');
  if (partes.length !== 3) return false;
  const [ts, nonce, sig] = partes;
  if (!assinaturaConfere(sig, assinar(`ig-oauth:${ts}.${nonce}`))) return false;
  // 15 minutos para fazer o login — mais que isso é link velho.
  return agora - Number(ts) < 15 * 60 * 1000 && agora >= Number(ts) - 60_000;
}

export async function urlDeAutorizacao(): Promise<string> {
  const { appId } = await lerConfigInstagram();
  if (!appId) throw new IgError('Preencha o ID do app do Instagram em Instagram → Conexão.', 400);
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: urlDeRetorno(),
    response_type: 'code',
    scope: ESCOPOS.join(','),
    state: criarState(),
    force_reauth: 'true',
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

// ── A volta do login ─────────────────────────────────────────────────────────────

export async function conectarPeloCodigo(code: string): Promise<{ ok: true; username: string | null; avisos: string[] } | { erro: string }> {
  const { appId, appSecret } = await lerConfigInstagram();
  if (!appId || !appSecret) return { erro: 'Faltam o ID e a chave secreta do app do Instagram.' };

  // (1) código → token curto. Esta rota é a única que ainda é form-urlencoded.
  let curto: { access_token?: string; user_id?: string | number; error_message?: string };
  try {
    const r = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: urlDeRetorno(),
        code: code.replace(/#_$/, ''),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    curto = await r.json();
    if (!r.ok || !curto.access_token) return { erro: `O Instagram não trocou o código: ${curto.error_message ?? r.status}. Tente conectar de novo.` };
  } catch {
    return { erro: 'Não consegui falar com o Instagram para trocar o código.' };
  }

  // (2) curto → longo (60 dias).
  let longo: { access_token?: string; expires_in?: number };
  try {
    const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: curto.access_token });
    const r = await fetch(`${IG_GRAPH}/access_token?${q}`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    longo = await r.json();
    if (!r.ok || !longo.access_token) return { erro: 'O Instagram não deu o token de 60 dias. Tente conectar de novo.' };
  } catch {
    return { erro: 'Não consegui falar com o Instagram para pegar o token de 60 dias.' };
  }
  const token = longo.access_token;

  // (3) quem é. `user_id` é o id da conta profissional — o mesmo que chega nos webhooks.
  let perfil: { user_id?: string; id?: string; username?: string; name?: string; profile_picture_url?: string };
  try {
    perfil = await ig(`/me?fields=user_id,username,name,profile_picture_url`, { token });
  } catch (e) {
    return { erro: `Não consegui ler o perfil: ${e instanceof Error ? e.message : e}` };
  }
  const igUserId = String(perfil.user_id ?? curto.user_id ?? perfil.id ?? '');
  if (!igUserId) return { erro: 'O Instagram não devolveu o id da conta.' };

  const db = createServerClient();
  const linha = {
    ig_user_id: igUserId,
    username: perfil.username ?? null,
    nome: perfil.name ?? null,
    foto_url: perfil.profile_picture_url ?? null,
    token_expira_em: new Date(Date.now() + Number(longo.expires_in ?? 5_184_000) * 1000).toISOString(),
    status: 'conectada',
    ultimo_erro: null,
    atualizado_em: new Date().toISOString(),
  };
  const { data: conta, error } = await db.from('ig_contas').upsert(linha, { onConflict: 'ig_user_id' }).select('id').single();
  if (error || !conta) return { erro: `Conectado, mas não consegui guardar: ${error?.message}` };
  const { error: eCofre } = await db.rpc('sf_ig_guardar_token', { p_conta: conta.id, p_token: token });
  if (eCofre) return { erro: `Conectado, mas o token não foi para o cofre: ${eCofre.message}` };
  esquecerTokenIg(igUserId);

  // (4) webhooks: a conta + o app.
  const avisos: string[] = [];
  const a = await assinarConta(igUserId, token);
  if ('erro' in a) avisos.push(a.erro);
  const w = await apontarWebhookDoApp();
  if ('erro' in w) avisos.push(w.erro);

  return { ok: true, username: perfil.username ?? null, avisos };
}

/** A conta passa a mandar os eventos dela para o app (sem isso, silêncio total). */
export async function assinarConta(igUserId: string, token?: string | null): Promise<{ ok: true } | { erro: string }> {
  try {
    await ig(`/me/subscribed_apps?subscribed_fields=${CAMPOS_WEBHOOK.join(',')}`, {
      method: 'POST',
      token: token ?? null,
      conta: igUserId,
    });
    await createServerClient()
      .from('ig_contas')
      .update({ webhook_assinado_em: new Date().toISOString() })
      .eq('ig_user_id', igUserId);
    return { ok: true };
  } catch (e) {
    return { erro: `Assinar a conta nos webhooks: ${e instanceof Error ? e.message : e}` };
  }
}

/**
 * Aponta o webhook de Instagram DO APP para o SendFlow. É o objeto `instagram` — o
 * WhatsApp (objeto `whatsapp_business_account`, que o QS usa) não é tocado.
 * Usa o app da Meta (ID + segredo de Conexões → Dados do app da Meta).
 */
export async function apontarWebhookDoApp(): Promise<{ ok: true } | { erro: string }> {
  const meta = await lerConfigMeta();
  if (!meta.appId || !meta.appSecret || !meta.verifyToken) {
    return { erro: 'Webhook do app: preencha os Dados do app da Meta em Conexões (ou configure o webhook no painel da Meta).' };
  }
  const url = urlDoWebhookIg();
  if (!url.startsWith('https://')) return { erro: `Webhook do app: o endereço público não é https (${url}).` };
  try {
    const q = new URLSearchParams({
      object: 'instagram',
      callback_url: url,
      verify_token: meta.verifyToken,
      fields: CAMPOS_WEBHOOK.join(','),
      include_values: 'true',
      access_token: `${meta.appId}|${meta.appSecret}`,
    });
    const r = await fetch(`https://graph.facebook.com/${IG_VERSAO}/${meta.appId}/subscriptions`, {
      method: 'POST',
      body: q,
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    if (!r.ok || !j.success) return { erro: `Webhook do app: ${j.error?.message ?? r.status}. Configure no painel da Meta (Instagram → Webhooks).` };
    return { ok: true };
  } catch {
    return { erro: 'Webhook do app: não consegui falar com a Meta.' };
  }
}

/** Renova os tokens que vencem em menos de 10 dias. Chamado pelo tick, 1x por hora no máximo. */
export async function renovarTokensInstagram(): Promise<number> {
  const db = createServerClient();
  const limite = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from('ig_contas')
    .select('id,ig_user_id')
    .eq('status', 'conectada')
    .lt('token_expira_em', limite)
    .limit(20);
  let n = 0;
  for (const c of (data ?? []) as { id: string; ig_user_id: string }[]) {
    try {
      const r = await ig<{ access_token?: string; expires_in?: number }>(
        `${IG_GRAPH}/refresh_access_token?grant_type=ig_refresh_token`,
        { conta: c.ig_user_id },
      );
      if (!r.access_token) continue;
      await db.rpc('sf_ig_guardar_token', { p_conta: c.id, p_token: r.access_token });
      await db
        .from('ig_contas')
        .update({ token_expira_em: new Date(Date.now() + Number(r.expires_in ?? 5_184_000) * 1000).toISOString(), ultimo_erro: null })
        .eq('id', c.id);
      esquecerTokenIg(c.ig_user_id);
      n += 1;
    } catch (e) {
      await db
        .from('ig_contas')
        .update({ ultimo_erro: `Renovar o token: ${e instanceof Error ? e.message : e}` })
        .eq('id', c.id);
    }
  }
  return n;
}
