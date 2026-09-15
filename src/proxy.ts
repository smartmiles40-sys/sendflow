import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_SESSAO, lerSessao, loginExigido } from '@/lib/auth';

/**
 * A porta da frente do painel.
 *
 * No Next.js 16 este arquivo se chama `proxy.ts` — o antigo `middleware.ts` foi
 * renomeado e agora roda no runtime Node por padrão, o que é justamente o que permite
 * validar o cookie com `node:crypto` aqui em vez de duplicar a lógica no Edge.
 *
 * O que NÃO passa por login, e por quê:
 *   • `/api/webhooks/*`  — quem chama é a Evolution e o Resend; a credencial deles é o
 *                          segredo na URL (Evolution) ou a assinatura Svix (Resend).
 *   • `/api/e/*`         — pixel, clique e descadastro são abertos por definição: quem
 *                          os aciona é o destinatário do e-mail, que não tem login aqui.
 *   • `/api/dispatch/*`  — o motor é chamado pelo cron e se protege com CRON_SECRET.
 *   • `/login`           — obviamente.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (ehPublico(pathname)) return NextResponse.next();
  // Sem APP_USERS o app roda aberto (útil para subir e testar). A tela de
  // configurações mostra um alerta enquanto estiver assim.
  if (!loginExigido()) return NextResponse.next();

  const sessao = lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);
  if (sessao) return NextResponse.next();

  // Requisição de API responde 401 em JSON; a tela do cliente entende e redireciona.
  // Devolver o HTML do login para um `fetch` faria o erro aparecer como "JSON inválido".
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sessão expirada. Entre novamente.' }, { status: 401 });
  }

  const destino = req.nextUrl.clone();
  destino.pathname = '/login';
  // Guarda para onde a pessoa ia, e o login devolve ela ao mesmo lugar.
  destino.search = `?de=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(destino);
}

const PUBLICOS = ['/login', '/api/auth/', '/api/webhooks/', '/api/e/', '/api/dispatch/'];

function ehPublico(pathname: string): boolean {
  return PUBLICOS.some((p) => pathname === p || pathname.startsWith(p));
}

export const config = {
  /**
   * Sem `matcher`, o proxy rodaria em CADA requisição — inclusive CSS, JS e imagens —
   * e a página de login apareceria sem estilo nenhum. O padrão abaixo exclui os
   * caminhos internos do Next e os arquivos estáticos.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)'],
};
