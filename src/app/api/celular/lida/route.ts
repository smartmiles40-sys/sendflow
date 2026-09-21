import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { marcarComoLida } from '@/lib/whatsapp/evolution';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';

/** Marca como lidas as mensagens recebidas de uma conversa (some o contador verde). */
export async function POST(req: Request) {
  const parsed = await readJson<{ conexao?: string; jid?: string; ids?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const { conexao, jid } = parsed.data;
  const ids = Array.isArray(parsed.data.ids) ? parsed.data.ids.map(String).filter(Boolean).slice(0, 100) : [];
  if (!jid) return NextResponse.json({ error: 'Falta a conversa.' }, { status: 400 });
  if (!ids.length) return NextResponse.json({ ok: true });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, conexao ?? null);
  if ('res' in aberta) return aberta.res;

  try {
    await marcarComoLida(aberta.conexao.instance_name, jid, ids.map((id) => ({ id, fromMe: false })));
  } catch (e) {
    return respostaDeErro(e);
  }
  return NextResponse.json({ ok: true });
}
