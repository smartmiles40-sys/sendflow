import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { reagir } from '@/lib/whatsapp/evolution';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';

/** Reage a uma mensagem (👍 ❤️ 😂…). `emoji` vazio tira a reação. */
export async function POST(req: Request) {
  const parsed = await readJson<{
    conexao?: string;
    jid?: string;
    id?: string;
    fromMe?: boolean;
    participant?: string | null;
    emoji?: string;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const { conexao, jid, id, participant } = parsed.data;
  const emoji = String(parsed.data.emoji ?? '');
  if (!jid || !id) return NextResponse.json({ error: 'Falta a conversa ou a mensagem.' }, { status: 400 });
  // Um emoji só (que pode ocupar vários caracteres por causa de tom de pele e junções).
  if (emoji.length > 16) return NextResponse.json({ error: 'Reação inválida.' }, { status: 400 });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, conexao ?? null);
  if ('res' in aberta) return aberta.res;

  try {
    await reagir(aberta.conexao.instance_name, jid, { id, fromMe: parsed.data.fromMe === true, participant }, emoji);
  } catch (e) {
    return respostaDeErro(e);
  }
  return NextResponse.json({ ok: true });
}
