// Os dados do app da Meta — lidos do SendFlow, com as variáveis de ambiente de reserva.
//
// Desde a 0021 a tela de Conexões guarda o App ID, o segredo do app (no Vault) e o
// config_id do botão; o verify token do webhook o próprio SendFlow inventa na primeira
// leitura. Ninguém precisa mais abrir a Vercel para conectar um número.
//
// Cache curto porque o webhook da Meta chega em rajada e cada batida confere a
// assinatura com o segredo — ir ao Vault em todas seria desperdício. Quem salva chama
// `esquecerConfigMeta()`; as outras instâncias do servidor veem a mudança em até 30 s.

import { randomBytes } from 'node:crypto';
import { createServerClient } from '../supabase/server';
import { chamar } from './cloud';

export interface ConfigMeta {
  appId: string | null;
  /** Segredo do app: assina o webhook e troca o código do botão por token. */
  appSecret: string | null;
  configId: string | null;
  verifyToken: string | null;
}

interface ValorCadastro {
  config_id?: string | null;
  app_id?: string | null;
  verify_token?: string | null;
}

const env = (k: string) => (process.env[k] ?? '').trim() || null;

let cache: { v: ConfigMeta; ate: number } | null = null;

export function esquecerConfigMeta(): void {
  cache = null;
}

async function lerCadastro(): Promise<ValorCadastro> {
  const { data } = await createServerClient()
    .from('app_settings')
    .select('valor')
    .eq('chave', 'meta_cadastro')
    .maybeSingle();
  return (data?.valor ?? {}) as ValorCadastro;
}

async function gravarCadastro(v: ValorCadastro): Promise<string | null> {
  const { error } = await createServerClient()
    .from('app_settings')
    .upsert({ chave: 'meta_cadastro', valor: v }, { onConflict: 'chave' });
  return error ? error.message : null;
}

export async function lerConfigMeta(): Promise<ConfigMeta> {
  if (cache && cache.ate > Date.now()) return cache.v;

  let cadastro: ValorCadastro = {};
  let segredo: string | null = null;
  try {
    cadastro = await lerCadastro();
    const { data } = await createServerClient().rpc('sf_cfg_segredo', { p_nome: 'meta_app_secret' });
    segredo = typeof data === 'string' && data ? data : null;
  } catch {
    // Banco fora do ar: segue com o que houver no ambiente.
  }

  let verifyToken = cadastro.verify_token || env('META_WEBHOOK_VERIFY_TOKEN');
  if (!verifyToken) {
    // Primeira vez: o SendFlow inventa o seu. A Meta só precisa que ele volte igual.
    verifyToken = randomBytes(24).toString('hex');
    const erro = await gravarCadastro({ ...cadastro, verify_token: verifyToken }).catch(() => 'falhou');
    if (erro) verifyToken = null;
  }

  const v: ConfigMeta = {
    appId: cadastro.app_id || env('META_APP_ID'),
    appSecret: segredo || env('META_APP_SECRET'),
    configId: cadastro.config_id || env('META_CONFIG_ID'),
    verifyToken,
  };
  cache = { v, ate: Date.now() + 30_000 };
  return v;
}

/**
 * Guarda o que veio da tela. Campo omitido = fica como está; o segredo é só de escrita
 * (a tela nunca o recebe de volta). App ID + segredo são conferidos na Meta antes de
 * gravar: um dígito errado aqui faria o webhook recusar TODA mensagem, calado.
 */
export async function salvarConfigMeta(p: {
  appId?: string;
  appSecret?: string;
  configId?: string;
}): Promise<{ ok: true; nomeDoApp: string | null } | { erro: string }> {
  const cadastro = await lerCadastro();
  const atual = await lerConfigMeta();

  const appId = p.appId === undefined ? cadastro.app_id ?? null : p.appId.trim() || null;
  const configId = p.configId === undefined ? cadastro.config_id ?? null : p.configId.trim() || null;
  const appSecret = (p.appSecret ?? '').trim();

  if (appId && !/^\d{5,25}$/.test(appId)) return { erro: 'O App ID tem só números.' };
  if (configId && !/^\d{5,25}$/.test(configId)) return { erro: 'O id da configuração tem só números.' };
  if (appSecret && !/^[A-Za-z0-9]{16,64}$/.test(appSecret)) {
    return { erro: 'A chave secreta do app são 32 letras e números, sem espaço.' };
  }

  let nomeDoApp: string | null = null;
  const idParaConferir = appId ?? atual.appId;
  const segredoParaConferir = appSecret || atual.appSecret;
  if ((appSecret || p.appId !== undefined) && idParaConferir && segredoParaConferir) {
    try {
      const r = await chamar<{ name?: string }>(`/${idParaConferir}?fields=id,name`, {
        token: `${idParaConferir}|${segredoParaConferir}`,
        timeoutMs: 10_000,
      });
      nomeDoApp = r?.name ? String(r.name) : null;
    } catch (e) {
      return {
        erro: `A Meta não reconheceu esse App ID com essa chave secreta: ${e instanceof Error ? e.message : e}`,
      };
    }
  }

  if (appSecret) {
    const { error } = await createServerClient().rpc('sf_cfg_guardar_segredo', {
      p_nome: 'meta_app_secret',
      p_valor: appSecret,
    });
    if (error) return { erro: `Não consegui guardar a chave no cofre: ${error.message}` };
  }

  const erro = await gravarCadastro({ ...cadastro, app_id: appId, config_id: configId });
  if (erro) return { erro };
  esquecerConfigMeta();
  return { ok: true, nomeDoApp };
}

/**
 * Dá para cadastrar número oficial? Com token de ambiente, sempre; sem ele, cada número
 * traz o seu (botão da Meta ou colado à mão) — então basta o app estar configurado.
 */
export async function cloudConfigurada(): Promise<boolean> {
  if (env('META_ACCESS_TOKEN')) return true;
  const c = await lerConfigMeta();
  return Boolean(c.appId && c.appSecret);
}
