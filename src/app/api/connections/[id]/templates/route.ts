import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { CloudError, listarTemplates } from '@/lib/whatsapp/cloud';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Os templates aprovados deste número.
 *
 * Por que guardar uma cópia local em vez de perguntar à Meta a cada tela: o compositor
 * precisa do texto real e da CONTAGEM de variáveis a cada tecla, para conferir antes do
 * disparo que o número de parâmetros bate. Fazer isso contra a Graph API significaria
 * uma chamada externa por digitação e um limite de taxa queimado à toa.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('whatsapp_templates')
    .select('*')
    .eq('connection_id', id)
    .order('status', { ascending: true })
    .order('nome', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

/**
 * Puxa a lista da Meta e regrava a cópia local.
 *
 * O `upsert` sobrescreve o que já existe (mesmo connection_id + nome + idioma) porque
 * o status de um template MUDA sozinho do lado da Meta: um `APPROVED` vira `PAUSED`
 * depois de muita denúncia, e continuar disparando um template pausado é jogar a
 * campanha inteira no erro 132015.
 *
 * O que sumiu da Meta é apagado daqui: template removido lá não pode continuar
 * selecionável no compositor.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: bruta } = await supabase
    .from('connections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!bruta) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
  const conexao = bruta as Connection;

  if (conexao.provider !== 'cloud') {
    return NextResponse.json(
      {
        error:
          'Templates são da API oficial da Meta. Um número conectado por QR Code manda texto livre e não usa template.',
      },
      { status: 409 },
    );
  }
  if (!conexao.waba_id) {
    return NextResponse.json(
      {
        errors: [
          {
            field: 'waba_id',
            message: 'Cadastre o ID da conta do WhatsApp Business (WABA ID) nesta conexão para listar os templates.',
          },
        ],
      },
      { status: 400 },
    );
  }

  let templates;
  try {
    templates = await listarTemplates(conexao.waba_id, conexao.phone_number_id);
  } catch (e) {
    const erro = e instanceof CloudError ? e : new CloudError(String(e));
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }

  const agora = new Date().toISOString();
  const linhas = templates.map((t) => ({
    connection_id: id,
    nome: t.nome,
    idioma: t.idioma,
    categoria: t.categoria,
    status: t.status,
    corpo: t.corpo,
    cabecalho_tipo: t.cabecalho_tipo,
    cabecalho_texto: t.cabecalho_texto,
    rodape: t.rodape,
    botoes: t.botoes,
    variaveis_corpo: t.variaveis_corpo,
    variaveis_cabecalho: t.variaveis_cabecalho,
    meta_id: t.meta_id,
    sincronizado_em: agora,
  }));

  if (linhas.length) {
    for (let i = 0; i < linhas.length; i += 200) {
      const { error } = await supabase
        .from('whatsapp_templates')
        .upsert(linhas.slice(i, i + 200), { onConflict: 'connection_id,nome,idioma' });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Sobrou alguém que não veio da Meta desta vez: foi apagado lá.
  const { error: limpezaErro } = await supabase
    .from('whatsapp_templates')
    .delete()
    .eq('connection_id', id)
    .or(`sincronizado_em.is.null,sincronizado_em.lt.${agora}`);
  if (limpezaErro) {
    return NextResponse.json({
      sincronizados: linhas.length,
      aviso: `Templates atualizados, mas a limpeza dos removidos falhou: ${limpezaErro.message}`,
    });
  }

  const { data: atuais } = await supabase
    .from('whatsapp_templates')
    .select('*')
    .eq('connection_id', id)
    .order('nome', { ascending: true });

  return NextResponse.json({
    sincronizados: linhas.length,
    aprovados: (atuais ?? []).filter((t) => t.status === 'APPROVED').length,
    templates: atuais ?? [],
  });
}
