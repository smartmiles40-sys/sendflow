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
  if (!loginExigido()) return semBanco(req, pathname) ?? NextResponse.next();

  const sessao = lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);
  if (sessao) return semBanco(req, pathname) ?? NextResponse.next();

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

/**
 * Banco não configurado: leva para o diagnóstico em vez de deixar a tela quebrar.
 *
 * É o estado de quem acabou de clonar o projeto, e sem isto TODA tela morre com um
 * stack trace de "Missing NEXT_PUBLIC_SUPABASE_URL" — o pior primeiro contato possível
 * com um sistema. `/configuracoes` é a única tela que funciona sem banco, justamente
 * porque o trabalho dela é dizer o que está faltando.
 *
 * Roda DEPOIS da checagem de sessão, e não antes: o diagnóstico revela quais variáveis
 * de ambiente existem, então ele fica atrás do login assim que houver login.
 *
 * Vale só para navegação; requisição de API continua devolvendo o erro real, que é o
 * que quem está depurando precisa ver.
 */
function semBanco(req: NextRequest, pathname: string): NextResponse | null {
  const configurado = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (configurado || pathname.startsWith('/api/') || pathname === '/configuracoes') return null;

  const destino = req.nextUrl.clone();
  destino.pathname = '/configuracoes';
  destino.search = '';
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
