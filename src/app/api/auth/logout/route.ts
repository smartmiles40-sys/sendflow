import { NextResponse } from 'next/server';
import { COOKIE_SESSAO } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // `maxAge: 0` apaga o cookie no navegador. O cookie é assinado, não guardado em
  // lugar nenhum do servidor, então sair é exatamente isto: descartar o papel.
  res.cookies.set({ name: COOKIE_SESSAO, value: '', path: '/', maxAge: 0 });
  return res;
}
