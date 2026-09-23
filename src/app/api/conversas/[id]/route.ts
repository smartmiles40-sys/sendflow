import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { iniciarFluxo, responderManual } from '@/lib/automacao/motor';
import { enviarTemplate, CloudError } from '@/lib/whatsapp/cloud';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** A conversa aberta: mensagens, contato, fluxos em andamento. */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const db = createServerClient();
  const { data: conversa } = await db.from('wa_conversas').select('*').eq('id', id).maybeSingle();
  if (!conversa) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

  const [{ data: mensagens }, { data: contato }, { data: execucoes }, { data: conexao }] = await Promise.all([
    db.from('wa_mensagens').select('*').eq('conversa_id', id).order('criado_em', { ascending: false }).limit(200),
    conversa.contact_id
      ? db.from('contacts').select('*').eq('id', conversa.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('fluxo_execucoes')
      .select('id,fluxo_id,estado,no_atual,acordar_em,iniciada_em,erro,fluxos(nome)')
      .eq('conversa_id', id)
      .order('iniciada_em', { ascending: false })
      .limit(10),
    db.from('connections').select('id,nome,numero,phone_number_id').eq('id', conversa.connection_id).maybeSingle(),
  ]);

  return NextResponse.json({
    conversa,
    contato,
    conexao,
    execucoes: execucoes ?? [],
    // Mais antigas primeiro, que é a ordem de leitura.
    mensagens: (mensagens ?? []).reverse(),
  });
}

/**
 * O que o atendente faz na conversa:
 *   enviar {texto, pausarHoras?}      · template {nome, idioma, variaveis[]}
 *   pausar {horas}  · retomar          · lida  · fechar · abrir
 *   tag {tag, remover?}               · campo {chave, valor}
 *   iniciar_fluxo {fluxoId}           · parar_fluxos
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  const db = createServerClient();

  const { data: conversa } = await db.from('wa_conversas').select('*').eq('id', id).maybeSingle();
  if (!conversa) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
  const { data: conexaoBruta } = await db.from('connections').select('*').eq('id', conversa.connection_id).maybeSingle();
  const conexao = conexaoBruta as Connection | null;
  if (!conexao) return NextResponse.json({ error: 'O número desta conversa foi removido.' }, { status: 409 });

  const ok = () => NextResponse.json({ ok: true });
  const falha = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

  switch (b.acao) {
    case 'enviar': {
      const texto = String(b.texto ?? '').trim();
      if (!texto) return falha('Escreva a mensagem.');
      if (texto.length > 4096) return falha('Mensagem longa demais (máx. 4096).');
      // Por padrão, quem responde à mão pausa o robô por 12 h — é o que evita o fluxo
      // de boas-vindas atropelar o atendente no meio da conversa.
      const horas = b.pausarHoras === undefined ? 12 : Math.max(0, Number(b.pausarHoras) || 0);
      const r = await responderManual(db, conexao, id, { type: 'text', text: { body: texto, preview_url: /https?:\/\//.test(texto) } }, horas);
      return r.erro ? falha(r.erro, 502) : ok();
    }
    case 'midia': {
      const url = String(b.url ?? '');
      const tipo = String(b.tipo ?? 'image');
      if (!/^https:\/\//.test(url) || !['image', 'video', 'audio', 'document'].includes(tipo)) return falha('Mídia inválida.');
      const midia: Record<string, unknown> = { link: url };
      if (b.legenda && tipo !== 'audio') midia.caption = String(b.legenda).slice(0, 1024);
      if (tipo === 'document') midia.filename = String(b.nome ?? 'documento.pdf');
      const r = await responderManual(db, conexao, id, { type: tipo, [tipo]: midia }, 12);
      return r.erro ? falha(r.erro, 502) : ok();
    }
    case 'template': {
      const nome = String(b.nome ?? '');
      const idioma = String(b.idioma ?? 'pt_BR');
      if (!nome || !conexao.phone_number_id) return falha('Escolha o template.');
      const variaveis = Array.isArray(b.variaveis) ? b.variaveis.map(String) : [];
      let wamid: string | null = null;
      let erro: string | null = null;
      try {
        wamid = (await enviarTemplate(conexao.phone_number_id, { para: conversa.wa_id, template: nome, idioma, variaveisCorpo: variaveis })).messageId;
      } catch (e) {
        erro = e instanceof CloudError ? e.message : String(e);
      }
      const { data: tpl } = await db
        .from('whatsapp_templates')
        .select('corpo')
        .eq('connection_id', conexao.id)
        .eq('nome', nome)
        .eq('idioma', idioma)
        .maybeSingle();
      const texto = String(tpl?.corpo ?? `[template ${nome}]`).replace(/\{\{(\d+)\}\}/g, (_, n) => variaveis[Number(n) - 1] ?? '');
      await db.from('wa_mensagens').insert({
        conversa_id: id,
        direcao: 'out',
        tipo: 'template',
        texto,
        payload: { template: nome, idioma, variaveis },
        wamid,
        status: erro ? 'falha' : 'enviado',
        erro,
        origem: 'manual',
      });
      await db.from('wa_conversas').update({ ultima_mensagem_em: new Date().toISOString(), ultima_previa: texto.slice(0, 200) }).eq('id', id);
      return erro ? falha(erro, 502) : ok();
    }
    case 'pausar': {
      const horas = Math.min(24 * 30, Math.max(1, Number(b.horas) || 24));
      await db.from('wa_conversas').update({ automacao_pausada_ate: new Date(Date.now() + horas * 3_600_000).toISOString() }).eq('id', id);
      return ok();
    }
    case 'retomar':
      await db.from('wa_conversas').update({ automacao_pausada_ate: null }).eq('id', id);
      return ok();
    case 'lida':
      await db.from('wa_conversas').update({ nao_lidas: 0 }).eq('id', id);
      return ok();
    case 'fechar':
    case 'abrir':
      await db.from('wa_conversas').update({ status: b.acao === 'fechar' ? 'fechada' : 'aberta', nao_lidas: 0 }).eq('id', id);
      return ok();
    case 'tag': {
      if (!conversa.contact_id) return falha('Conversa sem contato.');
      const tag = String(b.tag ?? '').trim();
      if (!tag) return falha('Escreva a tag.');
      const { data: c } = await db.from('contacts').select('tags').eq('id', conversa.contact_id).single();
      const atuais = ((c?.tags ?? []) as string[]).filter((t) => t.toLowerCase() !== tag.toLowerCase());
      await db.from('contacts').update({ tags: b.remover ? atuais : [...atuais, tag] }).eq('id', conversa.contact_id);
      return ok();
    }
    case 'campo': {
      if (!conversa.contact_id) return falha('Conversa sem contato.');
      const chave = String(b.chave ?? '');
      if (!chave) return falha('Escolha o campo.');
      const valor = String(b.valor ?? '').trim();
      if (chave === 'nome' || chave === 'email') {
        const { error } = await db.from('contacts').update({ [chave]: valor || null }).eq('id', conversa.contact_id);
        if (error) return falha((error as { code?: string }).code === '23505' ? 'Este e-mail já é de outro contato.' : error.message);
        return ok();
      }
      const { data: c } = await db.from('contacts').select('campos').eq('id', conversa.contact_id).single();
      const campos = { ...((c?.campos ?? {}) as Record<string, unknown>) };
      if (valor) campos[chave] = valor;
      else delete campos[chave];
      await db.from('contacts').update({ campos }).eq('id', conversa.contact_id);
      return ok();
    }
    case 'iniciar_fluxo': {
      const fluxoId = String(b.fluxoId ?? '');
      if (!fluxoId) return falha('Escolha o fluxo.');
      // Iniciar à mão tira a pausa: o atendente está pedindo para o robô assumir.
      await db.from('wa_conversas').update({ automacao_pausada_ate: null }).eq('id', id);
      const r = await iniciarFluxo(db, { fluxoId, conexao, waId: conversa.wa_id });
      return r.erro ? falha(r.erro) : ok();
    }
    case 'parar_fluxos':
      await db
        .from('fluxo_execucoes')
        .update({ estado: 'cancelada', acordar_em: null, concluida_em: new Date().toISOString(), erro: 'Parado pelo atendente.' })
        .eq('conversa_id', id)
        .in('estado', ['rodando', 'aguardando_resposta', 'aguardando_tempo']);
      return ok();
    default:
      return falha('Ação desconhecida.');
  }
}
