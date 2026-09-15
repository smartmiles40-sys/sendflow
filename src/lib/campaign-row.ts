import type { CampaignDraft } from './validation';
import type { CampaignStatus, CampaignType } from './types';
import { isCategoria, type CategoriaKey } from './categories';

export interface CampaignRow {
  nome: string;
  tipo: CampaignType;
  categoria: CategoriaKey;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  audience_id: string | null;
  group_ids: string[] | null;
  alvo: 'grupos' | 'contatos';
  list_ids: string[] | null;
  connection_id: string | null;
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
    midia_url: draft.midia_url ?? null,
    mencionar_todos: Boolean(draft.mencionar_todos),
    // Grupo e contato são alvos excludentes: guardar os dois preenchidos deixaria a
    // campanha ambígua para quem lesse o histórico, e o fan-out só olha um deles.
    audience_id: paraContatos ? null : (alvo.audienceId ?? null),
    group_ids: paraContatos ? null : alvo.groupIds?.length ? alvo.groupIds : null,
    alvo: paraContatos ? 'contatos' : 'grupos',
    list_ids: paraContatos && alvo.listIds?.length ? alvo.listIds : null,
    connection_id: alvo.connectionId ?? null,
    enviar_em,
    status,
  };
}
