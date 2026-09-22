// O motor de envio de e-mail. Mesmo desenho do WhatsApp: fila por destinatário,
// tick curto, idempotente e interrompível.
//
// A diferença de ritmo é proposital: WhatsApp precisa de 8–15 s entre mensagens para o
// número não ser derrubado; e-mail é um canal feito para volume, então aqui o limite é
// o do provedor (algumas dezenas por segundo), não o do anti-bloqueio. Por isso o
// e-mail vai em lote com um respiro curto, e não um a um com espera longa.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, EmailCampaign } from '../types';
import { montarEmail } from '../email/render';
import { enviarEmail, EmailError, provedorAtivo, AVISO_SEM_PROVEDOR } from '../email/provider';
import { segredoConfigurado } from '../auth';
import { tokenAleatorio } from '../seguranca';
import { urlPublica } from '../url';
import { dormir, Orcamento } from './ritmo';
import { paginar } from '../supabase/paginar';

const MAX_TENTATIVAS = 3;
const MINUTOS_ATE_ORFA = 15;
/** Respiro entre e-mails. Segura o ritmo abaixo do limite de qualquer provedor sério. */
const INTERVALO_MS = 120;
/** Custo estimado de um envio ao decidir se ainda cabe no orçamento do tick. */
const CUSTO_ENVIO_MS = 1_500;

export interface ResultadoEmailWorker {
  promovidas: number;
  enviados: number;
  falhas: number;
  pendentes: number;
  fechadas: number;
  avisos: string[];
}

// ── 1. Campanha agendada vira fila ───────────────────────────────────────────────

export async function promoverEmailCampanhas(
  supabase: SupabaseClient,
  agora: Date,
  avisos: string[],
): Promise<number> {
  const { data: vencidas, error } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('status', 'agendada')
    .lte('enviar_em', agora.toISOString())
    .order('enviar_em', { ascending: true })
    .limit(20);
  if (error) {
    avisos.push(`Erro ao listar campanhas de e-mail: ${error.message}`);
    return 0;
  }
  if (!vencidas?.length) return 0;

  let promovidas = 0;
  for (const bruta of vencidas as EmailCampaign[]) {
    const { data: ganha } = await supabase
      .from('email_campaigns')
      .update({ status: 'enviando' })
      .eq('id', bruta.id)
      .eq('status', 'agendada')
      .select('*')
      .maybeSingle();
    if (!ganha) continue;

    const campanha = ganha as EmailCampaign;
    const { linhas, aviso } = await montarFilaEmail(supabase, campanha);
    if (aviso) avisos.push(`[${campanha.nome}] ${aviso}`);

    if (!linhas.length) {
      await supabase
        .from('email_campaigns')
        .update({ status: 'erro' })
        .eq('id', campanha.id);
      continue;
    }

    // Em blocos: um insert de 5 mil linhas numa tacada estoura o corpo da requisição.
    for (let i = 0; i < linhas.length; i += 500) {
      const { error: insErr } = await supabase
        .from('email_recipients')
        .upsert(linhas.slice(i, i + 500), { onConflict: 'campaign_id,email', ignoreDuplicates: true });
      if (insErr) {
        avisos.push(`[${campanha.nome}] erro ao montar a fila: ${insErr.message}`);
        await supabase.from('email_campaigns').update({ status: 'erro' }).eq('id', campanha.id);
        break;
      }
    }
    promovidas += 1;
  }
  return promovidas;
}

interface LinhaEmail {
  campaign_id: string;
  contact_id: string;
  email: string;
  nome: string | null;
  token: string;
  variante: 'A' | 'B';
  status: 'pendente';
}

/**
 * Resolve o público da campanha de e-mail.
 *
 * Três filtros, nesta ordem, e nenhum deles é opcional:
 *   • pertence a alguma das listas escolhidas;
 *   • `status_email = 'ativo'` — quem descadastrou, deu bounce ou marcou spam FICA DE FORA.
 *     Mandar para essas pessoas é o caminho mais rápido para o domínio ser bloqueado;
 *   • se a campanha tem tags, o contato precisa ter pelo menos uma.
 */
async function montarFilaEmail(
  supabase: SupabaseClient,
  campanha: EmailCampaign,
): Promise<{ linhas: LinhaEmail[]; aviso: string | null }> {
  if (!campanha.list_ids?.length) {
    return { linhas: [], aviso: 'Nenhuma lista selecionada.' };
  }

  const { data: membros, error: mErr } = await paginar<{ contact_id: string }>((de, ate) =>
    supabase
      .from('list_members')
      .select('contact_id')
      .in('list_id', campanha.list_ids)
      .order('contact_id', { ascending: true })
      .range(de, ate),
  );
  if (mErr) return { linhas: [], aviso: `Erro ao ler as listas: ${mErr}` };

  const ids = [...new Set(membros.map((m) => m.contact_id))];
  if (!ids.length) return { linhas: [], aviso: 'As listas escolhidas estão vazias.' };

  const contatos: Contact[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    let q = supabase
      .from('contacts')
      .select('*')
      .in('id', ids.slice(i, i + 300))
      .eq('status_email', 'ativo')
      .not('email', 'is', null);
    if (campanha.tags?.length) q = q.overlaps('tags', campanha.tags);
    const { data } = await q;
    contatos.push(...((data ?? []) as Contact[]));
  }

  // A mesma pessoa em duas listas recebe UM e-mail. O índice único (campaign_id, email)
  // é a rede de segurança; deduplicar aqui evita o conflito no insert.
  const vistos = new Set<string>();
  const linhas: LinhaEmail[] = [];
  const temTesteAB = Boolean(campanha.assunto_b?.trim());

  for (const c of contatos) {
    const email = (c.email ?? '').trim().toLowerCase();
    if (!email || vistos.has(email)) continue;
    vistos.add(email);
    linhas.push({
      campaign_id: campanha.id,
      contact_id: c.id,
      email,
      nome: c.nome,
      token: tokenAleatorio(24),
      // Alternar A/B/A/B divide o público em metades comparáveis sem sortear nada:
      // a ordem vem do banco, que não tem relação com quem abre mais.
      variante: temTesteAB && linhas.length % 2 === 1 ? 'B' : 'A',
      status: 'pendente',
    });
  }

  return {
    linhas,
    aviso: linhas.length ? null : 'Nenhum contato ativo com e-mail nas listas escolhidas.',
  };
}

// ── 2. Destravar o que ficou preso ───────────────────────────────────────────────

export async function recuperarOrfasEmail(supabase: SupabaseClient, agora: Date): Promise<void> {
  const corte = new Date(agora.getTime() - MINUTOS_ATE_ORFA * 60_000).toISOString();

  await supabase
    .from('email_recipients')
    .update({ status: 'enviado', enviado_em: agora.toISOString() })
    .eq('status', 'enviando')
    .lt('atualizado_em', corte)
    .not('provider_message_id', 'is', null);

  await supabase
    .from('email_recipients')
    .update({ status: 'pendente' })
    .eq('status', 'enviando')
    .lt('atualizado_em', corte)
    .is('provider_message_id', null)
    .lt('tentativas', MAX_TENTATIVAS);

  await supabase
    .from('email_recipients')
    .update({ status: 'falha', erro: 'Envio não concluído após várias tentativas.' })
    .eq('status', 'enviando')
    .lt('atualizado_em', corte)
    .is('provider_message_id', null)
    .gte('tentativas', MAX_TENTATIVAS);
}

// ── 3. Drenar ────────────────────────────────────────────────────────────────────

interface FilaEmailItem {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  email: string;
  nome: string | null;
  token: string;
  variante: 'A' | 'B';
  tentativas: number;
}

async function drenar(
  supabase: SupabaseClient,
  orcamento: Orcamento,
  resultado: ResultadoEmailWorker,
): Promise<void> {
  if (!provedorAtivo()) {
    resultado.avisos.push(AVISO_SEM_PROVEDOR);
    return;
  }

  // Sem AUTH_SECRET não há como assinar os links de clique, e a montagem do e-mail
  // lança. Sem esta guarda, cada destinatário seria reivindicado, falharia três vezes
  // e viraria 'falha' — a campanha inteira queimada por uma variável de ambiente que
  // leva dez segundos para configurar. Parando aqui, a fila espera intacta.
  if (!segredoConfigurado()) {
    resultado.avisos.push(
      'AUTH_SECRET não configurado: o envio de e-mail está parado para não queimar a fila. Gere um com: openssl rand -hex 32',
    );
    return;
  }

  const baseUrl = urlPublica();
  const config = await lerConfigRodape(supabase);
  // Cache das campanhas dentro do tick: o HTML é o mesmo para todo mundo, só o
  // token muda. Reler a campanha a cada destinatário seria uma consulta por e-mail.
  const campanhas = new Map<string, EmailCampaign>();

  while (orcamento.cabe(CUSTO_ENVIO_MS)) {
    const { data: fila, error } = await supabase
      .from('email_recipients')
      .select('id,campaign_id,contact_id,email,nome,token,variante,tentativas,email_campaigns!inner(status)')
      .eq('status', 'pendente')
      .eq('email_campaigns.status', 'enviando')
      .order('criado_em', { ascending: true })
      .limit(20);
    if (error) {
      resultado.avisos.push(`Erro ao ler a fila de e-mail: ${error.message}`);
      return;
    }
    const itens = (fila ?? []) as unknown as FilaEmailItem[];
    if (!itens.length) return;

    for (const item of itens) {
      if (!orcamento.cabe(CUSTO_ENVIO_MS)) return;

      const { data: ganha } = await supabase
        .from('email_recipients')
        .update({ status: 'enviando', tentativas: item.tentativas + 1 })
        .eq('id', item.id)
        .eq('status', 'pendente')
        .select('id')
        .maybeSingle();
      if (!ganha) continue;

      let campanha = campanhas.get(item.campaign_id);
      if (!campanha) {
        const { data } = await supabase
          .from('email_campaigns')
          .select('*')
          .eq('id', item.campaign_id)
          .maybeSingle();
        if (!data) {
          await supabase
            .from('email_recipients')
            .update({ status: 'falha', erro: 'Campanha não encontrada.' })
            .eq('id', item.id);
          resultado.falhas += 1;
          continue;
        }
        campanha = data as EmailCampaign;
        campanhas.set(item.campaign_id, campanha);
      }

      // Os campos livres do contato entram na personalização ({{cidade}}, {{plano}}…).
      let campos: Record<string, string> = {};
      let empresa: string | null = null;
      if (item.contact_id) {
        const { data: c } = await supabase
          .from('contacts')
          .select('campos,empresa')
          .eq('id', item.contact_id)
          .maybeSingle();
        campos = (c?.campos ?? {}) as Record<string, string>;
        empresa = (c?.empresa ?? null) as string | null;
      }

      const assunto =
        item.variante === 'B' && campanha.assunto_b ? campanha.assunto_b : campanha.assunto;

      const montado = montarEmail(
        campanha.html,
        assunto,
        { nome: item.nome, email: item.email, empresa, campos },
        {
          baseUrl,
          token: item.token,
          preheader: campanha.preheader,
          rodapeTexto: config.rodape_texto,
          rodapeEndereco: config.rodape_endereco,
        },
      );

      try {
        const envio = await enviarEmail({
          para: item.email,
          paraNome: item.nome,
          de: campanha.remetente_email,
          deNome: campanha.remetente_nome,
          responderPara: campanha.responder_para,
          assunto: montado.assunto,
          html: montado.html,
          // O corpo em texto da própria campanha ganha do derivado, quando existe.
          texto: campanha.texto?.trim() ? campanha.texto : montado.texto,
          urlDescadastro: montado.urlDescadastro,
        });
        const agoraIso = new Date().toISOString();
        await supabase
          .from('email_recipients')
          .update({
            status: 'enviado',
            provider_message_id: envio.messageId,
            enviado_em: agoraIso,
            erro: null,
          })
          .eq('id', item.id);
        await supabase.from('email_events').insert({
          recipient_id: item.id,
          campaign_id: item.campaign_id,
          tipo: 'enviado',
          detalhe: envio.provedor,
        });
        resultado.enviados += 1;
      } catch (e) {
        const erro = e instanceof EmailError ? e : new EmailError(String(e));

        // Limite de ritmo do provedor NÃO é culpa deste destinatário. Devolver a linha
        // para a fila COM A TENTATIVA DE VOLTA é o que impede o 429 de queimar a
        // campanha inteira: sem isso, as três tentativas de cada um eram gastas em
        // segundos contra um limite que passaria em meio minuto.
        if (erro.status === 429) {
          await supabase
            .from('email_recipients')
            .update({ status: 'pendente', tentativas: item.tentativas, erro: erro.message.slice(0, 500) })
            .eq('id', item.id);
          resultado.avisos.push(
            `O provedor pediu ${Math.round(erro.esperarMs / 1000)}s de pausa — a fila continua no próximo ciclo.`,
          );
          // Esperar aqui só vale se sobrar orçamento para mandar alguma coisa depois.
          if (orcamento.cabe(erro.esperarMs + CUSTO_ENVIO_MS)) {
            await dormir(erro.esperarMs);
            continue;
          }
          return;
        }

        const desistir = erro.permanente || item.tentativas + 1 >= MAX_TENTATIVAS;
        await supabase
          .from('email_recipients')
          .update({ status: desistir ? 'falha' : 'pendente', erro: erro.message.slice(0, 500) })
          .eq('id', item.id);
        if (desistir) {
          resultado.falhas += 1;
          await supabase.from('email_events').insert({
            recipient_id: item.id,
            campaign_id: item.campaign_id,
            tipo: 'falha',
            detalhe: erro.message.slice(0, 300),
          });
        }
        resultado.avisos.push(`${item.email}: ${erro.message}`);
      }

      await dormir(INTERVALO_MS);
    }
  }
}

async function lerConfigRodape(
  supabase: SupabaseClient,
): Promise<{ rodape_texto: string | null; rodape_endereco: string | null }> {
  const { data } = await supabase
    .from('app_settings')
    .select('valor')
    .eq('chave', 'email_remetente')
    .maybeSingle();
  const v = (data?.valor ?? {}) as Record<string, string>;
  return {
    rodape_texto: v.rodape_texto || null,
    rodape_endereco: v.rodape_endereco || null,
  };
}

// ── 4. Fechar ────────────────────────────────────────────────────────────────────

export async function fecharEmailCampanhas(
  supabase: SupabaseClient,
  agora: Date,
): Promise<number> {
  const { data: emVoo } = await supabase
    .from('email_campaigns')
    .select('id')
    .eq('status', 'enviando')
    .limit(50);
  if (!emVoo?.length) return 0;

  let fechadas = 0;
  for (const c of emVoo as { id: string }[]) {
    const { count: pendentes } = await supabase
      .from('email_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('status', ['pendente', 'enviando']);
    if ((pendentes ?? 0) > 0) continue;

    const { count: enviados } = await supabase
      .from('email_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .not('enviado_em', 'is', null);

    await supabase
      .from('email_campaigns')
      .update({
        status: (enviados ?? 0) === 0 ? 'erro' : 'enviada',
        enviado_em: agora.toISOString(),
      })
      .eq('id', c.id)
      .eq('status', 'enviando');
    fechadas += 1;
  }
  return fechadas;
}

// ── Orquestração ─────────────────────────────────────────────────────────────────

export async function rodarEmail(
  supabase: SupabaseClient,
  orcamento: Orcamento,
  agora: Date = new Date(),
): Promise<ResultadoEmailWorker> {
  const resultado: ResultadoEmailWorker = {
    promovidas: 0,
    enviados: 0,
    falhas: 0,
    pendentes: 0,
    fechadas: 0,
    avisos: [],
  };

  resultado.promovidas = await promoverEmailCampanhas(supabase, agora, resultado.avisos);
  await recuperarOrfasEmail(supabase, agora);
  await drenar(supabase, orcamento, resultado);
  resultado.fechadas = await fecharEmailCampanhas(supabase, agora);

  const { count } = await supabase
    .from('email_recipients')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pendente', 'enviando']);
  resultado.pendentes = count ?? 0;

  return resultado;
}
