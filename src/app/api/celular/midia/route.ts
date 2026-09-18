import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { baixarMidia } from '@/lib/whatsapp/evolution';
import { abrirConexao, respostaDeErro } from '@/lib/whatsapp/celular-servidor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Só servimos inline o que o navegador não executa. Qualquer outra coisa (um .html
// mandado por alguém no grupo, por exemplo) vira download — senão o arquivo rodaria
// com a sessão de quem está logado no painel.
const SEGUROS = /^(image\/(jpeg|png|webp|gif)|video\/mp4|audio\/(ogg|mpeg|mp4|aac)|application\/pdf)/;

/** A mídia de uma mensagem, decifrada pela Evolution, servida para o <img>/<video> da tela. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id) return NextResponse.json({ error: 'Falta o id da mensagem.' }, { status: 400 });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, url.searchParams.get('conexao'));
  if ('res' in aberta) return aberta.res;

  let midia;
  try {
    midia = await baixarMidia(aberta.conexao.instance_name, id);
  } catch (e) {
    return respostaDeErro(e);
  }
  if (!midia) return NextResponse.json({ error: 'Mídia indisponível (expirou no WhatsApp).' }, { status: 404 });

  const bytes = Buffer.from(midia.base64.replace(/^data:[^,]+,/, ''), 'base64');
  const mime = midia.mimetype.split(';')[0].trim().toLowerCase();
  const seguro = SEGUROS.test(mime);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': seguro ? mime : 'application/octet-stream',
      'Content-Disposition': seguro ? 'inline' : 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
