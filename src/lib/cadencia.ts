// Regras da cadência que não dependem de banco nem de tela — por isso testáveis.
//
// Uma cadência é um DESTINO (grupos, público salvo ou listas de contatos) mais uma fila
// de passos com data e hora marcadas. Cada passo é uma campanha comum; o que esta
// camada garante é que todos os passos de uma cadência vão sempre para o mesmo lugar.

import { isCategoria, type CategoriaKey } from './categories';
import type { CampaignType } from './types';
import type { ValidationError } from './validation';
import { formatWhen } from './format';

export interface DestinoCadencia {
  alvo: 'grupos' | 'contatos';
  audience_id: string | null;
  group_ids: string[] | null;
  list_ids: string[] | null;
  connection_id: string | null;
}

export interface Cadencia extends DestinoCadencia {
  id: string;
  nome: string;
  categoria: CategoriaKey;
  criado_em: string;
  atualizado_em: string;
}

export interface PassoEntrada {
  tipo: CampaignType;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  enviar_em: string | null;
}

const TIPOS: CampaignType[] = ['texto', 'imagem', 'video', 'pdf'];

function listaDeTexto(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const limpa = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return limpa.length ? limpa : null;
}

function idOuNulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Lê o destino do corpo da requisição e exige que ele seja EXPLÍCITO.
 *
 * Na campanha avulsa, "nenhum grupo escolhido" significa "todos os grupos ativos". Numa
 * cadência isso seria perigoso: um passo esquecido dispararia para a base inteira várias
 * vezes. Então aqui destino vazio é erro, não atalho.
 */
export function lerDestino(body: Record<string, unknown>): {
  destino: DestinoCadencia;
  errors: ValidationError[];
} {
  const alvo = body.alvo === 'contatos' ? 'contatos' : 'grupos';
  const destino: DestinoCadencia =
    alvo === 'contatos'
      ? {
          alvo,
          audience_id: null,
          group_ids: null,
          list_ids: listaDeTexto(body.list_ids),
          connection_id: idOuNulo(body.connection_id),
        }
      : {
          alvo,
          audience_id: idOuNulo(body.audience_id),
          group_ids: idOuNulo(body.audience_id) ? null : listaDeTexto(body.group_ids),
          list_ids: null,
          connection_id: idOuNulo(body.connection_id),
        };

  const errors: ValidationError[] = [];
  if (alvo === 'contatos' && !destino.list_ids) {
    errors.push({ field: 'destino', message: 'Escolha ao menos uma lista de contatos.' });
  }
  if (alvo === 'grupos' && !destino.audience_id && !destino.group_ids) {
    errors.push({ field: 'destino', message: 'Escolha os grupos ou um público salvo.' });
  }
  return { destino, errors };
}

export function lerCategoria(v: unknown): CategoriaKey {
  return isCategoria(v) ? v : 'avulsas';
}

/** Valida um passo. `agora` entra por parâmetro para o teste controlar o relógio. */
export function validarPasso(p: Partial<PassoEntrada>, agora: Date): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!p.tipo || !TIPOS.includes(p.tipo)) errors.push({ field: 'tipo', message: 'Tipo inválido.' });
  if (!String(p.mensagem ?? '').trim()) {
    errors.push({ field: 'mensagem', message: 'Escreva a mensagem.' });
  }
  if (p.tipo && p.tipo !== 'texto' && !p.midia_url) {
    errors.push({ field: 'midia_url', message: 'Envie a mídia para este tipo de mensagem.' });
  }
  if (!p.enviar_em) {
    errors.push({ field: 'enviar_em', message: 'Escolha a data e a hora do envio.' });
  } else {
    const t = new Date(p.enviar_em).getTime();
    if (Number.isNaN(t)) errors.push({ field: 'enviar_em', message: 'Data inválida.' });
    else if (t <= agora.getTime()) {
      errors.push({ field: 'enviar_em', message: 'A data precisa ser no futuro.' });
    }
  }
  return errors;
}

/**
 * Nome da campanha gerada por um passo: é o que aparece na lista de Campanhas e no
 * painel. Leva a data (e não "Mensagem 2") porque a posição muda quando alguém mexe na
 * data de um passo, e o nome ficaria mentindo.
 */
export function nomeDoPasso(nomeCadencia: string, enviarEm: string): string {
  return `${nomeCadencia.trim()} · ${formatWhen(enviarEm)}`;
}

/** Status de campanha em que o passo ainda pode ser editado, movido ou apagado. */
export const STATUS_EDITAVEIS = ['rascunho', 'agendada', 'cancelada', 'erro'] as const;

export function passoEditavel(status: string): boolean {
  return (STATUS_EDITAVEIS as readonly string[]).includes(status);
}
