import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { editarMensagem } from '@/lib/whatsapp/evolution';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';

/**
 * Corrige o texto de uma mensagem que já saiu. Quem recebe vê o texto novo com a marca
 * "Editada". O WhatsApp só aceita nos primeiros 15 minutos e só em mensagem de texto —
 * fora disso a Evolution devolve erro e a tela mostra o motivo.
 */
export async function POST(req: Request) {
  const parsed = await readJson<{ conexao?: string; jid?: string; id?: string; texto?: string }>(req);
  if (!parsed.ok) return parsed.res;
  const { conexao, jid, id } = parsed.data;
  const texto = String(parsed.data.texto ?? '').trim();
  if (!jid || !id) return NextResponse.json({ error: 'Falta a conversa ou a mensagem.' }, { status: 400 });
  if (!texto) return NextResponse.json({ error: 'O texto não pode ficar vazio.' }, { status: 400 });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, conexao ?? null);
  if ('res' in aberta) return aberta.res;

  try {
    await editarMensagem(aberta.conexao.instance_name, jid, id, texto);
  } catch (e) {
    return respostaDeErro(e);
  }
  return NextResponse.json({ ok: true });
}
