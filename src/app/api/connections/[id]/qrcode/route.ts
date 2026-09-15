import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  conectarInstancia,
  definirWebhook,
  desconectarInstancia,
  estadoInstancia,
  EvolutionError,
} from '@/lib/whatsapp/evolution';
import { urlDoWebhook } from '@/lib/whatsapp/conexao';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Devolve um QR Code novo para ler no celular.
 *
 * O QR do WhatsApp vale cerca de 40 segundos, então a tela pede um a cada 30 — por isso
 * esta rota é barata e pode ser chamada em laço. Se o número JÁ está conectado, ela não
 * gera QR nenhum: devolve `conectada` e a tela troca para o estado final.
 *
 * O webhook é reafirmado a cada QR de propósito. É o momento certo: se a URL do app
 * mudou (domínio novo, projeto novo na Vercel), reconectar conserta o apontamento sem
 * ninguém precisar saber que existe uma configuração de webhook.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data } = await supabase.from('connections').select('*').eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  const conexao = data as Connection;

  try {
    const estado = await estadoInstancia(conexao.instance_name);
    if (estado === 'conectada') {
      await supabase
        .from('connections')
        .update({ status: 'conectada', ultimo_erro: null })
        .eq('id', id);
      return NextResponse.json({ estado: 'conectada', qrcode: null });
    }

    // Best-effort: um erro aqui não deve impedir a pessoa de ver o QR.
    await definirWebhook(conexao.instance_name, urlDoWebhook()).catch(() => {});

    const qrcode = await conectarInstancia(conexao.instance_name);
    await supabase
      .from('connections')
      .update({ status: 'conectando', ultimo_erro: null })
      .eq('id', id);
    return NextResponse.json({ estado: 'conectando', qrcode });
  } catch (e) {
    const erro = e instanceof EvolutionError ? e : new EvolutionError(String(e));
    await supabase
      .from('connections')
      .update({ status: 'erro', ultimo_erro: erro.message.slice(0, 500) })
      .eq('id', id);
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }
}

/** Desconecta o número. A instância continua existindo e reconecta com um QR novo. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data } = await supabase.from('connections').select('*').eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });

  try {
    await desconectarInstancia((data as Connection).instance_name);
  } catch (e) {
    const erro = e instanceof EvolutionError ? e : new EvolutionError(String(e));
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }

  await supabase
    .from('connections')
    .update({ status: 'desconectada', numero: null, profile_name: null, profile_pic_url: null })
    .eq('id', id);
  return NextResponse.json({ ok: true });
}
