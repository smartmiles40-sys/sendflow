// Regras da enquete do WhatsApp, num lugar só: a campanha avulsa, a cadência e o motor
// de envio usam as mesmas.

import type { ValidationError } from './validation';

/** Limites do próprio WhatsApp. */
export const ENQUETE_MIN_OPCOES = 2;
export const ENQUETE_MAX_OPCOES = 12;
export const ENQUETE_MAX_CARACTERES = 100;

/**
 * Limpa a lista que veio da tela: tira espaços, opções vazias e repetidas. Opção
 * repetida o WhatsApp recusa, e vazia costuma ser a linha que a pessoa abriu e não usou.
 */
export function limparOpcoes(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const item of bruto) {
    if (typeof item !== 'string') continue;
    const opcao = item.trim();
    const chave = opcao.toLocaleLowerCase('pt-BR');
    if (!opcao || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(opcao);
  }
  return saida;
}

/** Erros da enquete já limpa. Vazio = pode enviar. */
export function validarEnquete(pergunta: string, opcoes: string[]): ValidationError[] {
  const erros: ValidationError[] = [];
  if (!pergunta.trim()) erros.push({ field: 'mensagem', message: 'Escreva a pergunta da enquete.' });
  if (pergunta.trim().length > 255) {
    erros.push({ field: 'mensagem', message: 'A pergunta passa de 255 caracteres.' });
  }
  if (opcoes.length < ENQUETE_MIN_OPCOES) {
    erros.push({ field: 'enquete_opcoes', message: `A enquete precisa de pelo menos ${ENQUETE_MIN_OPCOES} opções diferentes.` });
  } else if (opcoes.length > ENQUETE_MAX_OPCOES) {
    erros.push({ field: 'enquete_opcoes', message: `O WhatsApp aceita no máximo ${ENQUETE_MAX_OPCOES} opções.` });
  } else if (opcoes.some((o) => o.length > ENQUETE_MAX_CARACTERES)) {
    erros.push({ field: 'enquete_opcoes', message: `Cada opção pode ter até ${ENQUETE_MAX_CARACTERES} caracteres.` });
  }
  return erros;
}
