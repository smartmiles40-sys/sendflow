import type { CampaignType } from './types';
import type { CategoriaKey } from './categories';
import { limparOpcoes, validarEnquete } from './enquete';

export interface CampaignDraft {
  nome: string;
  tipo: CampaignType;
  categoria?: CategoriaKey;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  agendar: boolean;
  enviar_em: string | null;
  /** Só para enquete: a pergunta é a `mensagem`. */
  enquete_opcoes?: string[] | null;
  enquete_multipla?: boolean;
}

/**
 * O que muda a validação além do próprio rascunho.
 *
 * `alvo = 'contatos'` é o disparo em massa pela API oficial: ali o conteúdo não é a
 * `mensagem` escrita à mão, é o TEMPLATE aprovado pela Meta. Exigir texto livre nesse
 * caso pediria à pessoa algo que nem seria enviado.
 */
export interface ContextoCampanha {
  alvo?: 'grupos' | 'contatos';
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateCampaign(
  d: CampaignDraft,
  now: Date,
  ctx: ContextoCampanha = {},
): ValidationError[] {
  const errors: ValidationError[] = [];
  const emMassa = ctx.alvo === 'contatos';
  const TIPOS = ['texto', 'imagem', 'video', 'pdf', 'enquete'];
  if (!TIPOS.includes(d.tipo)) errors.push({ field: 'tipo', message: 'Tipo inválido.' });
  if (!d.nome.trim()) errors.push({ field: 'nome', message: 'Dê um nome à campanha.' });

  // No disparo em massa o conteúdo é o template aprovado; a conferência dele é a de
  // `validarCanal`, contra o que a Meta aprovou, e não contra o que foi digitado aqui.
  if (!emMassa) {
    if (d.tipo === 'enquete') {
      errors.push(...validarEnquete(d.mensagem, limparOpcoes(d.enquete_opcoes)));
    } else if (!d.mensagem.trim()) {
      errors.push({ field: 'mensagem', message: 'Escreva a mensagem.' });
    }
    if (d.tipo !== 'texto' && d.tipo !== 'enquete' && !d.midia_url) {
      errors.push({ field: 'midia_url', message: 'Envie a mídia para este tipo de campanha.' });
    }
  } else if (d.tipo === 'enquete') {
    errors.push({
      field: 'tipo',
      message: 'Enquete não existe na API oficial da Meta. Use enquete só em campanha de grupo.',
    });
  }
  if (d.agendar) {
    if (!d.enviar_em) {
      errors.push({ field: 'enviar_em', message: 'Escolha a data e hora.' });
    } else {
      const t = new Date(d.enviar_em).getTime();
      if (Number.isNaN(t)) {
        errors.push({ field: 'enviar_em', message: 'Data inválida.' });
      } else if (t <= now.getTime()) {
        errors.push({ field: 'enviar_em', message: 'A data precisa ser no futuro.' });
      }
    }
  }
  return errors;
}
