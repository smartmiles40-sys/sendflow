// O botão "Conectar com a Meta", lado do navegador (porte do QS, 23/09/2026).
//
// O botão abre a janela da PRÓPRIA Meta (Cadastro Incorporado, o mesmo do ManyChat).
// Dela voltam duas coisas, por caminhos diferentes:
//   • o CÓDIGO de uso único → no retorno do FB.login;
//   • os ids do número e da conta → numa mensagem (postMessage) da janela.
// Os três vão para o servidor, que troca o código pelo token. O token nunca passa
// por aqui.

import type { Connection } from '../types';

export interface ConfigCadastro {
  appId: string | null;
  configId: string | null;
  podeTrocarCodigo: boolean;
  webhookPronto: boolean;
  urlWebhook: string;
}

interface FbLoginResposta {
  authResponse?: { code?: string } | null;
}
interface Fb {
  init(o: Record<string, unknown>): void;
  login(cb: (r: FbLoginResposta) => void, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: Fb;
    fbAsyncInit?: () => void;
  }
}

let sdk: Promise<Fb> | null = null;

function carregarSdk(appId: string): Promise<Fb> {
  if (sdk) return sdk;
  sdk = new Promise<Fb>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v23.0' });
      resolve(window.FB!);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/pt_BR/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => {
      sdk = null;
      reject(new Error('Não consegui carregar a janela da Meta. Confira a internet ou desligue o bloqueador de anúncios.'));
    };
    document.body.appendChild(s);
  });
  return sdk;
}

export interface OpcoesConexao {
  appId: string;
  configId: string;
  modo: 'cloud' | 'coexistencia';
  pin?: string;
  nome?: string;
}

/**
 * Abre a janela da Meta, espera a pessoa terminar e manda tudo para o servidor.
 * Devolve a conexão pronta, ou lança com a frase certa (inclusive "cancelou").
 */
export async function conectarPelaMeta(o: OpcoesConexao): Promise<{ conexao: Connection; avisos: string[] }> {
  const FB = await carregarSdk(o.appId);

  let sessao: { phone_number_id?: string; waba_id?: string } | null = null;
  let cancelou: string | null = null;
  const ouvir = (ev: MessageEvent) => {
    try {
      if (!/(^|\.)facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
      if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (String(d.event || '').startsWith('FINISH')) sessao = d.data || {};
      else if (d.event === 'CANCEL') cancelou = d.data?.current_step || 'cancelado';
    } catch {
      /* outra mensagem qualquer */
    }
  };
  window.addEventListener('message', ouvir);

  try {
    const code = await new Promise<string | null>((resolve) => {
      FB.login((r) => resolve(r?.authResponse?.code || null), {
        config_id: o.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: '3',
          ...(o.modo === 'coexistencia' ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
        },
      });
    });
    // A mensagem com os ids às vezes chega logo DEPOIS do retorno do login.
    for (let i = 0; i < 15 && !sessao && !cancelou; i += 1) await new Promise((r) => setTimeout(r, 200));

    if (!code || cancelou) throw new Error('A conexão foi cancelada na janela da Meta.');
    const s = sessao as { phone_number_id?: string; waba_id?: string } | null;
    if (!s?.phone_number_id || !s?.waba_id) {
      throw new Error('A Meta não informou qual número foi escolhido. Conecte de novo e vá até o fim da janela.');
    }
    const res = await fetch('/api/connections/meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        wabaId: s.waba_id,
        phoneId: s.phone_number_id,
        modo: o.modo,
        pin: o.pin || null,
        nome: o.nome || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'O servidor recusou a conexão.');
    return { conexao: body.conexao as Connection, avisos: (body.avisos as string[]) ?? [] };
  } finally {
    window.removeEventListener('message', ouvir);
  }
}
