import { NextResponse } from 'next/server';
import { urlDeAutorizacao } from '@/lib/instagram/conexao';

export const dynamic = 'force-dynamic';

/** O botão "Conectar Instagram": manda para o login do próprio Instagram. */
export async function GET(req: Request) {
  try {
    return NextResponse.redirect(await urlDeAutorizacao());
  } catch (e) {
    const u = new URL('/instagram', req.url);
    u.searchParams.set('erro', e instanceof Error ? e.message : String(e));
    return NextResponse.redirect(u);
  }
}
