import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { DURACOES_FIXAR, fixarMensagem, type DuracaoFixar } from '@/lib/whatsapp/evolution';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';

/**
 * Fixa ou desafixa uma mensagem no topo da conversa, para todos. Precisa da Evolution
 * adaptada (rota /chat/pinMessage) — ver `fixarMensagem`.
 */
export async function POST(req: Request) {
  const parsed = await readJson<{
    conexao?: string;
    jid?: string;
    id?: string;
    fromMe?: boolean;
    participant?: string | null;
    acao?: string;
    duracao?: number;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const { conexao, jid, id, participant } = parsed.data;
  const acao = parsed.data.acao === 'unpin' ? 'unpin' : 'pin';
  const duracao = Number(parsed.data.duracao ?? 604_800);
  if (!jid || !id) return NextResponse.json({ error: 'Falta a conversa ou a mensagem.' }, { status: 400 });
  if (acao === 'pin' && !(DURACOES_FIXAR as readonly number[]).includes(duracao)) {
    return NextResponse.json({ error: 'Duração inválida (24 horas, 7 dias ou 30 dias).' }, { status: 400 });
  }

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, conexao ?? null);
  if ('res' in aberta) return aberta.res;

  try {
    await fixarMensagem(
      aberta.conexao.instance_name,
      jid,
      { id, fromMe: parsed.data.fromMe === true, participant },
      acao,
      duracao as DuracaoFixar,
    );
  } catch (e) {
    return respostaDeErro(e);
  }
  return NextResponse.json({ ok: true });
}
