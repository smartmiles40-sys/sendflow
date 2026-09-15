import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { credenciaisValidas, criarSessao, loginExigido, opcoesCookie, segredoConfigurado } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Atraso fixo em toda tentativa. Segura a força bruta e some com o tempo de resposta
 *  como pista de "este usuário existe". Não substitui uma senha boa — reduz o ritmo. */
const ATRASO_MS = 400;

export async function POST(req: Request) {
  const parsed = await readJson<{ usuario?: unknown; senha?: unknown }>(req);
  if (!parsed.ok) return parsed.res;

  if (!segredoConfigurado()) {
    return NextResponse.json(
      { error: 'AUTH_SECRET não configurado no servidor. Gere um com: openssl rand -hex 32' },
      { status: 503 },
    );
  }
  if (!loginExigido()) {
    return NextResponse.json(
      { error: 'Nenhum usuário configurado. Defina APP_USERS no formato email:senha.' },
      { status: 503 },
    );
  }

  await new Promise((r) => setTimeout(r, ATRASO_MS));

  const usuario = String(parsed.data.usuario ?? '').trim().toLowerCase();
  if (!credenciaisValidas(usuario, String(parsed.data.senha ?? ''))) {
    // Mensagem única para usuário errado e senha errada: dizer qual dos dois falhou
    // entrega metade da credencial de graça.
    return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, usuario });
  res.cookies.set({
    ...opcoesCookie(process.env.NODE_ENV === 'production'),
    value: criarSessao(usuario),
  });
  return res;
}
