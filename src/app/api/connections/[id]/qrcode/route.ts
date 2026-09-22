import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  conectarInstancia,
  criarInstancia,
  definirWebhook,
  desconectarInstancia,
  estadoInstancia,
  EvolutionError,
} from '@/lib/whatsapp/evolution';
import { instanciaDe, SEM_INSTANCIA, urlDoWebhook } from '@/lib/whatsapp/conexao';
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

  // Número da API oficial não tem QR Code: ele é registrado no Business Manager da
  // Meta, não pareado com um aparelho.
  const instancia = instanciaDe(conexao);
  if (!instancia) return NextResponse.json({ error: SEM_INSTANCIA }, { status: 409 });

  try {
    // O número não existe neste servidor da Evolution (ex.: trocou-se a EVOLUTION_API_URL
    // para um servidor novo): recria a instância com o MESMO nome e devolve o QR. Assim a
    // conexão, os grupos e o histórico de campanhas do SendFlow continuam valendo.
    const estado = await estadoInstancia(instancia).catch((e) => {
      if (!(e instanceof EvolutionError) || e.status !== 404) throw e;
      return null;
    });
    if (estado === null) {
      const qrcode = await criarInstancia(instancia, urlDoWebhook());
      await supabase
        .from('connections')
        .update({ status: 'conectando', ultimo_erro: null })
        .eq('id', id);
      return NextResponse.json({ estado: 'conectando', qrcode });
    }
    if (estado === 'conectada') {
      await supabase
        .from('connections')
        .update({ status: 'conectada', ultimo_erro: null })
        .eq('id', id);
      return NextResponse.json({ estado: 'conectada', qrcode: null });
    }

    // Best-effort: um erro aqui não deve impedir a pessoa de ver o QR.
    await definirWebhook(instancia, urlDoWebhook()).catch(() => {});

    const qrcode = await conectarInstancia(instancia);
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

  const instancia = instanciaDe(data as Connection);
  if (!instancia) return NextResponse.json({ error: SEM_INSTANCIA }, { status: 409 });

  try {
    await desconectarInstancia(instancia);
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
