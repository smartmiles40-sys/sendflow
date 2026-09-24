// O motor do Instagram: do evento do webhook até a resposta.
//
// Idempotente de propósito — a Meta reentrega o mesmo evento quando demora para ouvir
// 200. Comentário: `ig_comentarios.comment_id` único (insere antes de responder; se já
// existia, não responde de novo). DM: `ig_mensagens.mid` único (idem). Sem isso, um
// post que viraliza manda a mesma DM duas, três vezes para a mesma pessoa.
//
// Laço: a resposta pública que o SendFlow posta volta como comentário DA PRÓPRIA conta,
// e a DM que ele manda volta como "eco". Os dois são reconhecidos e ignorados.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ig, IgError } from './api';
import {
  escolherParaComentario,
  escolherParaDm,
  montarMensagem,
  personalizar,
  sortear,
  type AutomacaoIg,
} from './regras';

interface Conta {
  id: string;
  ig_user_id: string;
  username: string | null;
}

interface MensagemWebhook {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: { type?: string; payload?: { url?: string } }[];
    reply_to?: { story?: { id?: string; url?: string }; mid?: string };
    quick_reply?: { payload?: string };
  };
  postback?: { mid?: string; title?: string; payload?: string };
}

interface MudancaWebhook {
  field?: string;
  value?: {
    id?: string;
    text?: string;
    from?: { id?: string; username?: string; self_ig_scoped_id?: string };
    media?: { id?: string; media_product_type?: string };
    parent_id?: string;
  };
}

export interface ResultadoIg {
  mensagens: number;
  comentarios: number;
  respostas: number;
  erros: string[];
}

async function contaPorId(db: SupabaseClient, igUserId: string): Promise<Conta | null> {
  const { data } = await db.from('ig_contas').select('id,ig_user_id,username').eq('ig_user_id', igUserId).maybeSingle();
  return (data as Conta | null) ?? null;
}

async function automacoesDa(db: SupabaseClient, contaId: string): Promise<AutomacaoIg[]> {
  const { data } = await db
    .from('ig_automacoes')
    .select('id,nome,ativo,gatilho,config,criado_em')
    .eq('conta_id', contaId)
    .eq('ativo', true);
  return (data ?? []) as AutomacaoIg[];
}

/** Manda uma DM e grava como saída. Devolve o mid (ou lança IgError). */
export async function enviarDm(
  db: SupabaseClient,
  conta: Conta,
  conversaId: string,
  destino: { id: string } | { comment_id: string },
  message: Record<string, unknown>,
  origem: 'manual' | 'automacao',
  automacaoId: string | null = null,
): Promise<string | null> {
  const textoPrevia =
    typeof message.text === 'string'
      ? message.text
      : String(((message.attachment as { payload?: { text?: string } } | undefined)?.payload?.text) ?? '[mensagem]');
  try {
    const r = await ig<{ message_id?: string }>(`/${conta.ig_user_id}/messages`, {
      method: 'POST',
      conta: conta.ig_user_id,
      body: { recipient: destino, message },
    });
    const mid = r.message_id ?? null;
    await db.from('ig_mensagens').insert({
      conversa_id: conversaId,
      direcao: 'saida',
      tipo: 'comment_id' in destino ? 'resposta_privada' : 'texto',
      texto: textoPrevia,
      payload: message,
      mid,
      origem,
      automacao_id: automacaoId,
    });
    await db
      .from('ig_conversas')
      .update({ ultima_mensagem_em: new Date().toISOString(), ultima_previa: textoPrevia.slice(0, 140), atualizado_em: new Date().toISOString() })
      .eq('id', conversaId);
    return mid;
  } catch (e) {
    await db.from('ig_mensagens').insert({
      conversa_id: conversaId,
      direcao: 'saida',
      tipo: 'texto',
      texto: textoPrevia,
      payload: message,
      status: 'falha',
      erro: e instanceof Error ? e.message : String(e),
      origem,
      automacao_id: automacaoId,
    });
    throw e;
  }
}

async function garantirConversa(
  db: SupabaseClient,
  conta: Conta,
  igsid: string,
  dados: { username?: string | null } = {},
): Promise<{ id: string; nome: string | null; username: string | null; tags: string[]; automacao_pausada_ate: string | null; nova: boolean }> {
  const { data: existente } = await db
    .from('ig_conversas')
    .select('id,nome,username,tags,automacao_pausada_ate')
    .eq('conta_id', conta.id)
    .eq('igsid', igsid)
    .maybeSingle();
  if (existente) return { ...(existente as { id: string; nome: string | null; username: string | null; tags: string[]; automacao_pausada_ate: string | null }), nova: false };

  // Perfil de quem escreveu (nome e @). Falhar aqui não impede a conversa.
  let perfil: { name?: string; username?: string } = {};
  try {
    perfil = await ig(`/${igsid}?fields=name,username`, { conta: conta.ig_user_id, timeoutMs: 6000 });
  } catch {
    perfil = {};
  }
  const { data, error } = await db
    .from('ig_conversas')
    .upsert(
      { conta_id: conta.id, igsid, nome: perfil.name ?? null, username: perfil.username ?? dados.username ?? null },
      { onConflict: 'conta_id,igsid' },
    )
    .select('id,nome,username,tags,automacao_pausada_ate')
    .single();
  if (error || !data) throw new Error(`Não consegui criar a conversa: ${error?.message}`);
  return { ...(data as { id: string; nome: string | null; username: string | null; tags: string[]; automacao_pausada_ate: string | null }), nova: true };
}

async function aplicarTags(db: SupabaseClient, conversaId: string, atuais: string[], novas: string[] = []) {
  if (!novas.length) return;
  const tags = [...new Set([...(atuais ?? []), ...novas])];
  await db.from('ig_conversas').update({ tags }).eq('id', conversaId);
}

// ── Comentário ───────────────────────────────────────────────────────────────────

async function tratarComentario(db: SupabaseClient, conta: Conta, v: NonNullable<MudancaWebhook['value']>, r: ResultadoIg) {
  const commentId = String(v.id ?? '');
  const fromId = String(v.from?.id ?? '');
  if (!commentId || !fromId) return;
  // A própria conta comentando (inclusive a resposta pública que o robô acabou de postar).
  if (fromId === conta.ig_user_id || (v.from?.username && v.from.username === conta.username)) return;
  // Resposta dentro de outro comentário também dispara no ManyChat; mantemos igual.

  const texto = String(v.text ?? '');
  const mediaId = v.media?.id ? String(v.media.id) : null;
  const automacao = escolherParaComentario(await automacoesDa(db, conta.id), texto, mediaId);

  // Insere ANTES de responder: se a Meta reentregar, o insert falha e ninguém responde de novo.
  const { error: eIns } = await db.from('ig_comentarios').insert({
    conta_id: conta.id,
    comment_id: commentId,
    media_id: mediaId,
    from_id: fromId,
    from_username: v.from?.username ?? null,
    texto,
    automacao_id: automacao?.id ?? null,
  });
  if (eIns) return; // repetido
  r.comentarios += 1;
  if (!automacao) return;

  const pessoa = { username: v.from?.username ?? null, nome: null };
  const cfg = automacao.config;
  let algum = false;

  const publica = sortear(cfg.respostas_publicas ?? []);
  if (publica) {
    try {
      await ig(`/${commentId}/replies`, { method: 'POST', conta: conta.ig_user_id, body: { message: personalizar(publica, pessoa) } });
      await db.from('ig_comentarios').update({ respondido_publico_em: new Date().toISOString() }).eq('comment_id', commentId);
      algum = true;
    } catch (e) {
      r.erros.push(`resposta pública: ${e instanceof Error ? e.message : e}`);
      await db.from('ig_comentarios').update({ erro: `Resposta pública: ${e instanceof Error ? e.message : e}` }).eq('comment_id', commentId);
    }
  }

  if (cfg.dm_texto) {
    try {
      // A resposta privada vai para o COMENTÁRIO (a Meta entrega na DM da pessoa). A
      // conversa fica registrada pelo id de quem comentou.
      const conversa = await garantirConversa(db, conta, fromId, { username: v.from?.username ?? null });
      await enviarDm(
        db,
        conta,
        conversa.id,
        { comment_id: commentId },
        montarMensagem(personalizar(cfg.dm_texto, { ...pessoa, nome: conversa.nome }), cfg.dm_botoes),
        'automacao',
        automacao.id,
      );
      await aplicarTags(db, conversa.id, conversa.tags, cfg.tags);
      await db.from('ig_comentarios').update({ respondido_dm_em: new Date().toISOString() }).eq('comment_id', commentId);
      algum = true;
    } catch (e) {
      r.erros.push(`resposta privada: ${e instanceof Error ? e.message : e}`);
      await db.from('ig_comentarios').update({ erro: `Resposta privada: ${e instanceof Error ? e.message : e}` }).eq('comment_id', commentId);
    }
  }

  if (algum) {
    r.respostas += 1;
    await db.rpc('sf_ig_contar_disparo', { p_automacao: automacao.id });
  }
}

// ── DM ───────────────────────────────────────────────────────────────────────────

async function tratarMensagem(db: SupabaseClient, conta: Conta, m: MensagemWebhook, r: ResultadoIg) {
  const msg = m.message;
  const post = m.postback;
  const mid = msg?.mid ?? post?.mid ?? null;
  if (!mid) return;

  // Eco = mensagem que a PRÓPRIA conta mandou (pelo app do Instagram ou pelo SendFlow).
  if (msg?.is_echo) {
    const igsid = String(m.recipient?.id ?? '');
    if (!igsid) return;
    const { data: jaTem } = await db.from('ig_mensagens').select('id').eq('mid', mid).maybeSingle();
    if (jaTem) return; // o SendFlow já gravou quando mandou
    const conversa = await garantirConversa(db, conta, igsid);
    await db.from('ig_mensagens').insert({ conversa_id: conversa.id, direcao: 'saida', texto: msg.text ?? '[mídia]', mid, origem: 'eco', payload: msg });
    // Alguém respondeu pelo celular: o robô sai do caminho por 12 h, como no WhatsApp.
    await db
      .from('ig_conversas')
      .update({ automacao_pausada_ate: new Date(Date.now() + 12 * 3600_000).toISOString(), ultima_mensagem_em: new Date().toISOString(), ultima_previa: (msg.text ?? '[mídia]').slice(0, 140) })
      .eq('id', conversa.id);
    return;
  }
  if (msg?.is_deleted) return;

  const igsid = String(m.sender?.id ?? '');
  if (!igsid || igsid === conta.ig_user_id) return;

  const anexo = msg?.attachments?.[0];
  const ehMencaoStory = anexo?.type === 'story_mention';
  const ehRespostaStory = Boolean(msg?.reply_to?.story);
  const texto = post ? String(post.title ?? post.payload ?? '') : String(msg?.text ?? '');
  const tipo = ehMencaoStory ? 'story_mencao' : ehRespostaStory ? 'story_resposta' : post ? 'postback' : anexo ? (anexo.type ?? 'anexo') : 'texto';

  const conversa = await garantirConversa(db, conta, igsid);
  const { error: eIns } = await db.from('ig_mensagens').insert({
    conversa_id: conversa.id,
    direcao: 'entrada',
    tipo,
    texto: texto || (ehMencaoStory ? 'Mencionou você no story' : anexo ? `[${anexo.type}]` : ''),
    payload: m,
    mid,
    origem: 'cliente',
  });
  if (eIns) return; // repetido
  r.mensagens += 1;

  const agora = new Date().toISOString();
  const { data: atual } = await db.from('ig_conversas').select('nao_lidas').eq('id', conversa.id).maybeSingle();
  await db
    .from('ig_conversas')
    .update({
      ultima_entrada_em: agora,
      ultima_mensagem_em: agora,
      ultima_previa: (texto || `[${tipo}]`).slice(0, 140),
      nao_lidas: Number((atual as { nao_lidas?: number } | null)?.nao_lidas ?? 0) + 1,
      atualizado_em: agora,
    })
    .eq('id', conversa.id);
  await db.from('ig_contas').update({ ultima_entrada_em: agora }).eq('id', conta.id);

  if (conversa.automacao_pausada_ate && Date.parse(conversa.automacao_pausada_ate) > Date.now()) return;

  const automacao = escolherParaDm(await automacoesDa(db, conta.id), {
    texto,
    ehRespostaStory,
    ehMencaoStory,
    primeiraMensagem: conversa.nova,
  });
  if (!automacao?.config.dm_texto) return;

  try {
    await enviarDm(
      db,
      conta,
      conversa.id,
      { id: igsid },
      montarMensagem(personalizar(automacao.config.dm_texto, conversa), automacao.config.dm_botoes),
      'automacao',
      automacao.id,
    );
    await aplicarTags(db, conversa.id, conversa.tags, automacao.config.tags);
    await db.rpc('sf_ig_contar_disparo', { p_automacao: automacao.id });
    r.respostas += 1;
  } catch (e) {
    r.erros.push(`resposta na DM: ${e instanceof IgError ? e.message : String(e)}`);
  }
}

// ── Entrada ──────────────────────────────────────────────────────────────────────

export async function processarWebhookInstagram(db: SupabaseClient, payload: Record<string, unknown>): Promise<ResultadoIg> {
  const r: ResultadoIg = { mensagens: 0, comentarios: 0, respostas: 0, erros: [] };
  if (payload.object !== 'instagram') return r;
  const entradas = (payload.entry ?? []) as { id?: string; messaging?: MensagemWebhook[]; changes?: MudancaWebhook[] }[];
  for (const e of entradas) {
    const conta = await contaPorId(db, String(e.id ?? ''));
    if (!conta) continue; // conta que não está conectada aqui
    for (const m of e.messaging ?? []) {
      try {
        await tratarMensagem(db, conta, m, r);
      } catch (err) {
        r.erros.push(err instanceof Error ? err.message : String(err));
      }
    }
    for (const c of e.changes ?? []) {
      if (c.field !== 'comments' && c.field !== 'live_comments') continue;
      try {
        if (c.value) await tratarComentario(db, conta, c.value, r);
      } catch (err) {
        r.erros.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  return r;
}
