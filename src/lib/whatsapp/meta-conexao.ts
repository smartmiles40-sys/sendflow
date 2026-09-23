// A conexão pelo botão da Meta — "igual ManyChat", igual ao QS (23/09/2026).
//
// A pessoa clica em "Conectar com a Meta", faz login na janela da PRÓPRIA Meta
// (Cadastro Incorporado / Embedded Signup), escolhe a empresa e o número. Do navegador
// chegam aqui três coisas: um CÓDIGO de uso único e os ids do número e da conta.
// Este arquivo faz o resto, na ordem em que cada passo depende do anterior:
//
//   1. troca o código por um token de negócio (/oauth/access_token + segredo do app);
//   2. confere o número com esse token (nome, qualidade, limite);
//   3. assina o app na conta (subscribed_apps) — sem isso nenhuma mensagem chega;
//   4. número novo na Cloud API é REGISTRADO com o PIN de 6 dígitos; WhatsApp Business
//      do celular (Coexistência) pede a sincronização;
//   5. guarda a conexão e o token (Vault, via sf_meta_guardar_token — 0020);
//   6. aponta o webhook DESTE NÚMERO para o SendFlow.
//
// Sobre o passo 6, a decisão que protege o QS: o webhook "do app" é UM só por app da
// Meta. Se o SendFlow usar o mesmo app do QS e trocasse o webhook do app, o QS pararia
// de receber mensagens na hora (foi exatamente o que derrubou o QS em 01/09, quando o
// webhook apontava para o lugar errado). Por isso aqui se usa o OVERRIDE POR NÚMERO
// (`POST /{phone_number_id}` com `webhook_configuration`): só o número conectado aqui
// passa a falar com o SendFlow. O webhook do app — e o QS — ficam intactos.

import { createServerClient } from '../supabase/server';
import { urlPublica } from '../url';
import { chamar, CloudError, esquecerToken } from './cloud';
import type { Connection } from '../types';

export interface ConfigCadastro {
  appId: string | null;
  configId: string | null;
  /** Sem o segredo do app o código não vira token: o botão nem deve aparecer. */
  podeTrocarCodigo: boolean;
  /** Sem o verify token, a Meta não aceita apontar o webhook para cá. */
  webhookPronto: boolean;
  urlWebhook: string;
}

export function urlDoWebhookMeta(): string {
  return `${urlPublica()}/api/webhooks/meta`;
}

export async function lerConfigCadastro(): Promise<ConfigCadastro> {
  let configId: string | null = null;
  try {
    const { data } = await createServerClient()
      .from('app_settings')
      .select('valor')
      .eq('chave', 'meta_cadastro')
      .maybeSingle();
    const v = (data?.valor ?? {}) as { config_id?: unknown };
    configId = v.config_id ? String(v.config_id) : null;
  } catch {
    configId = null;
  }
  return {
    appId: (process.env.META_APP_ID ?? '').trim() || null,
    configId: configId || (process.env.META_CONFIG_ID ?? '').trim() || null,
    podeTrocarCodigo: Boolean((process.env.META_APP_SECRET ?? '').trim()),
    webhookPronto: Boolean((process.env.META_WEBHOOK_VERIFY_TOKEN ?? '').trim()),
    urlWebhook: urlDoWebhookMeta(),
  };
}

export async function salvarConfigId(configId: string): Promise<{ ok: true } | { erro: string }> {
  const id = String(configId ?? '').trim();
  if (id && !/^\d{5,25}$/.test(id)) return { erro: 'O id da configuração tem só números.' };
  const { error } = await createServerClient()
    .from('app_settings')
    .upsert({ chave: 'meta_cadastro', valor: { config_id: id || null } }, { onConflict: 'chave' });
  if (error) return { erro: error.message };
  return { ok: true };
}

/** Código de uso único (vale ~30 s) → token de negócio. */
async function trocarCodigo(code: string): Promise<{ token: string } | { erro: string }> {
  const appId = (process.env.META_APP_ID ?? '').trim();
  const secret = (process.env.META_APP_SECRET ?? '').trim();
  if (!appId || !secret) return { erro: 'Faltam META_APP_ID e META_APP_SECRET nas variáveis de ambiente.' };
  const versao = (process.env.META_API_VERSION ?? 'v23.0').trim() || 'v23.0';
  const url =
    `https://graph.facebook.com/${versao}/oauth/access_token?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    const j = (await res.json().catch(() => null)) as { access_token?: string; error?: { message?: string } } | null;
    if (!j?.access_token) {
      return {
        erro: `A Meta não trocou o código: ${j?.error?.message ?? 'sem resposta'}. Conecte de novo — o código vale poucos segundos.`,
      };
    }
    return { token: String(j.access_token) };
  } catch {
    return { erro: 'Não consegui falar com a Meta para trocar o código. Tente de novo.' };
  }
}

/**
 * Aponta o webhook DESTE número para o SendFlow (override por número — ver o topo).
 * A Meta faz o GET de verificação na hora; se o verify token não bater, ela recusa.
 */
export async function apontarWebhookDoNumero(
  phoneId: string,
  token?: string | null,
): Promise<{ ok: true; url: string } | { erro: string }> {
  const verify = (process.env.META_WEBHOOK_VERIFY_TOKEN ?? '').trim();
  if (!verify) return { erro: 'Falta META_WEBHOOK_VERIFY_TOKEN nas variáveis de ambiente.' };
  const url = urlDoWebhookMeta();
  if (!url.startsWith('https://')) {
    return { erro: `O endereço público do SendFlow não é https (${url}). Defina APP_URL.` };
  }
  try {
    await chamar(`/${phoneId}`, {
      method: 'POST',
      phone: phoneId,
      token: token ?? null,
      body: { webhook_configuration: { override_callback_uri: url, verify_token: verify } },
    });
    await createServerClient()
      .from('connections')
      .update({ webhook_apontado_em: new Date().toISOString() })
      .eq('phone_number_id', phoneId);
    return { ok: true, url };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}

export interface ResultadoConexao {
  ok: true;
  conexao: Connection;
  avisos: string[];
}

/**
 * Conecta (ou reconecta) um número pelo que voltou da janela da Meta.
 *   modo 'cloud'        → número só na API; `pin` (6 dígitos) registra o número
 *   modo 'coexistencia' → WhatsApp Business do celular continua funcionando junto
 */
export async function conectarNumero(p: {
  code: string;
  wabaId: string;
  phoneId: string;
  modo: 'cloud' | 'coexistencia';
  pin?: string | null;
  nome?: string | null;
}): Promise<ResultadoConexao | { erro: string }> {
  const modo = p.modo === 'coexistencia' ? 'coexistencia' : 'cloud';
  if (!p.code || !p.wabaId || !p.phoneId) {
    return { erro: 'A janela da Meta não devolveu o número. Conecte de novo e vá até o fim.' };
  }
  if (!/^\d+$/.test(p.wabaId) || !/^\d+$/.test(p.phoneId)) return { erro: 'Ids inválidos.' };
  const pin = String(p.pin ?? '').trim();
  if (pin && !/^\d{6}$/.test(pin)) return { erro: 'O PIN tem 6 números.' };

  const troca = await trocarCodigo(p.code);
  if ('erro' in troca) return troca;
  const token = troca.token;

  // (2) O número existe e este token enxerga ele?
  let info: Record<string, unknown>;
  try {
    info = await chamar<Record<string, unknown>>(
      `/${p.phoneId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
      { token },
    );
  } catch (e) {
    return { erro: `Não consegui ler o número na Meta: ${e instanceof Error ? e.message : e}` };
  }

  // (3) O app assinado na conta — é o que faz as mensagens chegarem.
  try {
    await chamar(`/${p.wabaId}/subscribed_apps`, { method: 'POST', token });
  } catch (e) {
    return { erro: `A Meta não deixou assinar o app na conta: ${e instanceof Error ? e.message : e}` };
  }

  // (4) Registro (Cloud) ou sincronização (Coexistência).
  const avisos: string[] = [];
  if (modo === 'cloud' && pin) {
    try {
      await chamar(`/${p.phoneId}/register`, {
        method: 'POST',
        token,
        body: { messaging_product: 'whatsapp', pin },
      });
    } catch (e) {
      // Número que já estava registrado responde erro — e está tudo bem.
      avisos.push(`Registro: ${e instanceof Error ? e.message : e}`);
    }
  } else if (modo === 'coexistencia') {
    for (const tipo of ['smb_app_state_sync', 'history']) {
      try {
        await chamar(`/${p.phoneId}/smb_app_data`, {
          method: 'POST',
          token,
          body: { messaging_product: 'whatsapp', sync_type: tipo },
        });
      } catch (e) {
        avisos.push(`Sincronização (${tipo}): ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // (5) Guarda. Mesmo número de novo = reconexão: atualiza a linha em vez de duplicar.
  const supabase = createServerClient();
  const numero = info.display_phone_number ? String(info.display_phone_number).replace(/\D/g, '') : null;
  const qualidadeBruta = String(info.quality_rating ?? 'UNKNOWN').toUpperCase();
  const qualidade = ['GREEN', 'YELLOW', 'RED'].includes(qualidadeBruta) ? qualidadeBruta : 'UNKNOWN';
  const nomeVerificado = info.verified_name ? String(info.verified_name) : null;
  const linha = {
    provider: 'cloud',
    instance_name: null,
    phone_number_id: p.phoneId,
    waba_id: p.wabaId,
    status: 'conectada',
    numero,
    profile_name: nomeVerificado,
    qualidade,
    modo_meta: modo,
    ultimo_erro: null,
  };

  const { data: existente } = await supabase
    .from('connections')
    .select('id')
    .eq('phone_number_id', p.phoneId)
    .maybeSingle();

  let conexao: Connection;
  if (existente) {
    const { data, error } = await supabase.from('connections').update(linha).eq('id', existente.id).select().single();
    if (error) return { erro: `Conectado na Meta, mas não consegui guardar: ${error.message}` };
    conexao = data as Connection;
  } else {
    const nome = String(p.nome ?? '').trim() || nomeVerificado || `WhatsApp ${numero ?? p.phoneId}`;
    const { data, error } = await supabase
      .from('connections')
      .insert({ ...linha, nome, msgs_por_segundo: 10, limite_diario: 0 })
      .select()
      .single();
    if (error) return { erro: `Conectado na Meta, mas não consegui guardar: ${error.message}` };
    conexao = data as Connection;
  }

  const { error: erroCofre } = await supabase.rpc('sf_meta_guardar_token', {
    p_conexao: conexao.id,
    p_token: token,
  });
  if (erroCofre) return { erro: `Conectado, mas o token não foi guardado no cofre: ${erroCofre.message}` };
  esquecerToken(p.phoneId);

  // (6) Webhook do número → SendFlow. Depois de guardar, para já usar o token novo.
  const w = await apontarWebhookDoNumero(p.phoneId, token);
  if ('erro' in w) avisos.push(`Webhook: ${w.erro}`);
  else conexao.webhook_apontado_em = new Date().toISOString();

  return { ok: true, conexao, avisos };
}

/**
 * Registra na Cloud API um número que aparece "Pendente" na Meta (caso de quem
 * adiciona o número pelo painel da Meta em vez do botão). O PIN vira a verificação em
 * duas etapas do número — guarde-o.
 */
export async function registrarNumero(phoneId: string, pin: string): Promise<{ ok: true } | { erro: string }> {
  const p = String(pin ?? '').trim();
  if (!/^\d{6}$/.test(p)) return { erro: 'O PIN tem 6 números.' };
  try {
    await chamar(`/${phoneId}/register`, {
      method: 'POST',
      phone: phoneId,
      body: { messaging_product: 'whatsapp', pin: p },
    });
    return { ok: true };
  } catch (e) {
    return { erro: `A Meta recusou o registro: ${e instanceof CloudError ? e.message : String(e)}` };
  }
}

/** Status do número na Meta (CONNECTED, PENDING…) — para o cartão avisar o que falta. */
export async function lerStatusNaMeta(phoneId: string): Promise<{
  status: string | null;
  nomeStatus: string | null;
  limite: string | null;
} | null> {
  try {
    const r = await chamar<Record<string, unknown>>(
      `/${phoneId}?fields=status,name_status,messaging_limit_tier`,
      { phone: phoneId, timeoutMs: 8000 },
    );
    return {
      status: r.status ? String(r.status) : null,
      nomeStatus: r.name_status ? String(r.name_status) : null,
      limite: r.messaging_limit_tier ? String(r.messaging_limit_tier) : null,
    };
  } catch {
    return null;
  }
}
