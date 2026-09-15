import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { assinar, assinaturaConfere } from '@/lib/seguranca';
import { ipDaRequisicao } from '@/lib/req';
import { urlPublica } from '@/lib/url';

export const dynamic = 'force-dynamic';

/**
 * Redirecionador de cliques.
 *
 * O link do e-mail aponta para cá; contamos o clique e mandamos a pessoa para o destino.
 *
 * A ASSINATURA é o ponto crítico desta rota. Sem ela, qualquer um monta
 * `/api/e/c/x?u=<site-falso>` e ganha um redirecionamento partindo do NOSSO domínio —
 * é assim que se constrói um link de phishing convincente, e o domínio queimado seria o
 * nosso. Com HMAC, só redirecionamos para endereço que este servidor gerou.
 *
 * Um clique não contabilizado é um KPI impreciso. Um redirecionador aberto é um
 * incidente de segurança. Por isso, na dúvida, esta rota recusa em vez de redirecionar.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(req.url);
  const alvoCodificado = url.searchParams.get('u') ?? '';
  const assinatura = url.searchParams.get('s') ?? '';

  if (!alvoCodificado || !assinatura) {
    return NextResponse.redirect(urlPublica(), 302);
  }
  if (!assinaturaConfere(assinatura, assinar(`${token}.${alvoCodificado}`))) {
    return NextResponse.json({ error: 'Link inválido ou adulterado.' }, { status: 400 });
  }

  let destino: string;
  try {
    destino = Buffer.from(alvoCodificado, 'base64url').toString('utf8');
    const u = new URL(destino);
    // Segunda barreira, depois da assinatura: mesmo um link assinado só pode apontar
    // para http(s). Fecha `javascript:` e `data:` caso um dia algo assine sem conferir.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocolo');
  } catch {
    return NextResponse.json({ error: 'Destino inválido.' }, { status: 400 });
  }

  if (token && !token.startsWith('teste-')) {
    try {
      const supabase = createServerClient();
      await supabase.rpc('registrar_clique', {
        p_token: token,
        p_url: destino,
        p_user_agent: req.headers.get('user-agent') ?? null,
        p_ip: ipDaRequisicao(req),
      });
    } catch {
      // Contabilizar é secundário: o que não pode falhar é a pessoa chegar no destino.
    }
  }

  // 302 (temporário) de propósito. Um 301 ficaria no cache do navegador e do provedor,
  // e os cliques seguintes da mesma pessoa nunca mais passariam por aqui.
  return NextResponse.redirect(destino, 302);
}
