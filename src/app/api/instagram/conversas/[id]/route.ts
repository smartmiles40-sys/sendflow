import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { createServerClient } from '@/lib/supabase/server';
import { enviarDm } from '@/lib/instagram/motor';
import { janelaAberta } from '@/lib/instagram/regras';

export const dynamic = 'force-dynamic';

/** As mensagens da conversa (e zera o "não lidas"). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServerClient();
  const [{ data: conversa }, { data: mensagens }] = await Promise.all([
    db.from('ig_conversas').select('*').eq('id', id).maybeSingle(),
    db.from('ig_mensagens').select('id,direcao,tipo,texto,status,erro,origem,criado_em').eq('conversa_id', id).order('criado_em', { ascending: true }).limit(300),
  ]);
  if (!conversa) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
  if (conversa.nao_lidas) await db.from('ig_conversas').update({ nao_lidas: 0 }).eq('id', id);
  return NextResponse.json({ conversa, mensagens: mensagens ?? [] });
}

/**
 * Resposta da equipe. Dentro da janela de 24 h; responder à mão pausa o robô por 12 h
 * nesta conversa (senão ele atropela o atendimento humano).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ texto?: unknown; pausar?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const db = createServerClient();
  const { data: conversa } = await db.from('ig_conversas').select('id,igsid,conta_id,ultima_entrada_em').eq('id', id).maybeSingle();
  if (!conversa) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

  if ('pausar' in parsed.data && parsed.data.texto === undefined) {
    const ate = parsed.data.pausar ? new Date(Date.now() + 7 * 24 * 3600_000).toISOString() : null;
    await db.from('ig_conversas').update({ automacao_pausada_ate: ate }).eq('id', id);
    return NextResponse.json({ ok: true, automacao_pausada_ate: ate });
  }

  const texto = String(parsed.data.texto ?? '').trim();
  if (!texto) return NextResponse.json({ error: 'Escreva a mensagem.' }, { status: 400 });
  if (texto.length > 1000) return NextResponse.json({ error: 'Máximo de 1.000 caracteres.' }, { status: 400 });
  if (!janelaAberta(conversa.ultima_entrada_em)) {
    return NextResponse.json({ error: 'Passou de 24 h desde a última mensagem da pessoa — o Instagram só deixa responder depois que ela escrever de novo.' }, { status: 409 });
  }
  const { data: conta } = await db.from('ig_contas').select('id,ig_user_id,username').eq('id', conversa.conta_id).maybeSingle();
  if (!conta) return NextResponse.json({ error: 'Conta do Instagram não encontrada.' }, { status: 404 });
  try {
    await enviarDm(db, conta, id, { id: conversa.igsid }, { text: texto }, 'manual');
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
  await db
    .from('ig_conversas')
    .update({ automacao_pausada_ate: new Date(Date.now() + 12 * 3600_000).toISOString() })
    .eq('id', id);
  return NextResponse.json({ ok: true });
}
