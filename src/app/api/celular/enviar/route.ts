import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { enviarNaConversa, type TipoMensagem } from '@/lib/whatsapp/evolution';
import { abrirConexao, midiaDoSendflow, respostaDeErro } from '@/lib/whatsapp/celular-servidor';
import { ehGrupo } from '@/lib/whatsapp/jid';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIPOS: TipoMensagem[] = ['texto', 'imagem', 'video', 'pdf'];

/**
 * Mensagem escrita na hora, pela tela Celular — como digitar no aparelho. Não passa
 * pela fila de campanhas: é conversa, não disparo, e não entra nos KPIs.
 */
export async function POST(req: Request) {
  const parsed = await readJson<{
    conexao?: string;
    jid?: string;
    tipo?: string;
    texto?: string;
    midiaUrl?: string | null;
    mencionarTodos?: boolean;
    citacao?: { id?: string; fromMe?: boolean; participant?: string | null; texto?: string | null } | null;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const { conexao, jid, citacao } = parsed.data;
  const tipo = (parsed.data.tipo ?? 'texto') as TipoMensagem;
  const texto = String(parsed.data.texto ?? '').trim();
  const midiaUrl = parsed.data.midiaUrl ? String(parsed.data.midiaUrl) : null;

  if (!jid) return NextResponse.json({ error: 'Falta a conversa.' }, { status: 400 });
  if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'Tipo de mensagem inválido.' }, { status: 400 });
  if (tipo === 'texto' && !texto) return NextResponse.json({ error: 'Escreva a mensagem.' }, { status: 400 });
  if (tipo !== 'texto' && !midiaUrl) return NextResponse.json({ error: 'Falta o arquivo.' }, { status: 400 });
  if (texto.length > 4096) return NextResponse.json({ error: 'Mensagem longa demais (máx. 4096 letras).' }, { status: 400 });
  if (midiaUrl && !midiaDoSendflow(midiaUrl, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) {
    return NextResponse.json({ error: 'Arquivo fora do armazenamento do SendFlow.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, conexao ?? null);
  if ('res' in aberta) return aberta.res;

  try {
    const r = await enviarNaConversa(aberta.conexao.instance_name, {
      destino: jid,
      tipo,
      texto,
      midiaUrl,
      mencionarTodos: Boolean(parsed.data.mencionarTodos) && ehGrupo(jid),
      citacao: citacao?.id
        ? {
            id: citacao.id,
            fromMe: citacao.fromMe === true,
            participant: citacao.participant ?? null,
            texto: citacao.texto ?? null,
          }
        : null,
    });
    return NextResponse.json({ ok: true, id: r.messageId });
  } catch (e) {
    return respostaDeErro(e);
  }
}
