import { NextResponse } from 'next/server';
import { conectarPeloCodigo, stateValido } from '@/lib/instagram/conexao';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A volta do login do Instagram. Sempre termina na tela /instagram, com ok ou erro. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const destino = new URL('/instagram', req.url);
  const voltar = (chave: string, valor: string) => {
    destino.searchParams.set(chave, valor);
    return NextResponse.redirect(destino);
  };

  if (u.searchParams.get('error')) {
    return voltar('erro', u.searchParams.get('error_description') ?? 'Login cancelado no Instagram.');
  }
  if (!stateValido(u.searchParams.get('state') ?? '')) {
    return voltar('erro', 'O link de conexão expirou ou não veio deste SendFlow. Clique em Conectar de novo.');
  }
  const code = u.searchParams.get('code');
  if (!code) return voltar('erro', 'O Instagram não devolveu o código.');

  const r = await conectarPeloCodigo(code);
  if ('erro' in r) return voltar('erro', r.erro);
  destino.searchParams.set('conectado', r.username ?? 'ok');
  if (r.avisos.length) destino.searchParams.set('avisos', r.avisos.join(' | '));
  return NextResponse.redirect(destino);
}
