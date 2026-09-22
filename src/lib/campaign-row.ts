import type { CampaignDraft } from './validation';
import type { CampaignStatus, CampaignType } from './types';
import { isCategoria, type CategoriaKey } from './categories';
import { limparOpcoes } from './enquete';

export interface CampaignRow {
  nome: string;
  tipo: CampaignType;
  categoria: CategoriaKey;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  enquete_opcoes?: string[] | null;
  enquete_multipla?: boolean;
  audience_id: string | null;
  group_ids: string[] | null;
  alvo: 'grupos' | 'contatos';
  list_ids: string[] | null;
  connection_id: string | null;
  /** Template aprovado na Meta. Só no disparo em massa (`alvo = 'contatos'`). */
  template_nome: string | null;
  template_idioma: string | null;
  template_variaveis: Record<string, string> | null;
  template_cabecalho_url: string | null;
  enviar_em: string | null;
  status: CampaignStatus;
}

/**
 * Para quem a campanha vai. Virou um objeto quando os alvos passaram de dois
 * (público salvo, grupos avulsos) para cinco — uma chamada com cinco posicionais
 * `null` seria ilegível e fácil de trocar de ordem sem o compilador perceber.
 */
export interface AlvoCampanha {
  audienceId?: string | null;
  groupIds?: string[] | null;
  alvo?: 'grupos' | 'contatos';
  listIds?: string[] | null;
  connectionId?: string | null;
  templateNome?: string | null;
  templateIdioma?: string | null;
  templateVariaveis?: Record<string, string> | null;
  templateCabecalhoUrl?: string | null;
}

export function buildCampaignRow(
  draft: CampaignDraft,
  alvo: AlvoCampanha,
  now: Date,
  opts: { asDraft: boolean },
): CampaignRow {
  const enviar_em = draft.agendar ? draft.enviar_em : now.toISOString();
  const status: CampaignStatus = opts.asDraft ? 'rascunho' : 'agendada';
  const paraContatos = alvo.alvo === 'contatos';

  return {
    nome: String(draft.nome ?? '').trim(),
    tipo: draft.tipo,
    categoria: isCategoria(draft.categoria) ? draft.categoria : 'avulsas',
    mensagem: String(draft.mensagem ?? '').trim(),
    midia_url: draft.tipo === 'enquete' ? null : (draft.midia_url ?? null),
    mencionar_todos: Boolean(draft.mencionar_todos),
    enquete_opcoes: draft.tipo === 'enquete' ? limparOpcoes(draft.enquete_opcoes) : null,
    enquete_multipla: draft.tipo === 'enquete' && Boolean(draft.enquete_multipla),
    // Grupo e contato são alvos excludentes: guardar os dois preenchidos deixaria a
    // campanha ambígua para quem lesse o histórico, e o fan-out só olha um deles.
    audience_id: paraContatos ? null : (alvo.audienceId ?? null),
    group_ids: paraContatos ? null : alvo.groupIds?.length ? alvo.groupIds : null,
    alvo: paraContatos ? 'contatos' : 'grupos',
    list_ids: paraContatos && alvo.listIds?.length ? alvo.listIds : null,
    connection_id: alvo.connectionId ?? null,
    // Template é do disparo em massa. Numa campanha de grupo ele fica nulo, e não
    // "guardado por via das dúvidas": o trigger da 0019 lê estes campos para decidir
    // se a campanha pode ser agendada.
    template_nome: paraContatos ? (alvo.templateNome?.trim() || null) : null,
    template_idioma: paraContatos ? (alvo.templateIdioma?.trim() || 'pt_BR') : null,
    template_variaveis: paraContatos ? (alvo.templateVariaveis ?? null) : null,
    template_cabecalho_url: paraContatos ? (alvo.templateCabecalhoUrl ?? null) : null,
    enviar_em,
    status,
  };
}
