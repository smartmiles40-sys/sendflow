import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { apagarParaTodos } from '@/lib/whatsapp/evolution';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';

/** "Apagar para todos" de uma mensagem nossa. Fica no lugar o aviso "Mensagem apagada". */
export async function POST(req: Request) {
  const parsed = await readJson<{ conexao?: string; jid?: string; id?: string }>(req);
  if (!parsed.ok) return parsed.res;
  const { conexao, jid, id } = parsed.data;
  if (!jid || !id) return NextResponse.json({ error: 'Falta a conversa ou a mensagem.' }, { status: 400 });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, conexao ?? null);
  if ('res' in aberta) return aberta.res;

  try {
    await apagarParaTodos(aberta.conexao.instance_name, jid, id);
  } catch (e) {
    return respostaDeErro(e);
  }
  return NextResponse.json({ ok: true });
}
