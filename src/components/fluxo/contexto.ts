'use client';

// O que os cartões do canvas precisam saber sem passar pelo `data` de cada nó.
//
// Guardar estatística e seleção no `data` do React Flow faria TODO nó ser recriado a
// cada atualização (a cada 30 s, a cada clique) — e o React Flow re-mede o nó quando o
// objeto muda. Pelo contexto, o nó só re-renderiza; a medida fica.

import { createContext, useContext } from 'react';
import type { No, TipoNo } from '@/lib/automacao/tipos';

export interface EstatNo {
  entrou: number;
  enviou: number;
  erro: number;
  saidas: Record<string, number>;
}

export interface EditorCtx {
  stats: Record<string, EstatNo>;
  /** Nós com problema grave de validação (borda laranja). */
  comProblema: Set<string>;
  selecionar: (id: string | null) => void;
  /** "+" ao lado de uma saída sem seta: abre o menu de criar bloco já ligado. */
  abrirMenuSaida: (noId: string, saida: string, clienteX: number, clienteY: number) => void;
  saidasLigadas: Set<string>; // `${noId}::${saida}`
  duplicar: (id: string) => void;
  apagar: (id: string) => void;
  nomeFluxo: (id: string | null) => string | null;
}

export const Ctx = createContext<EditorCtx | null>(null);

export function useEditor(): EditorCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEditor fora do editor');
  return c;
}

/** O que viaja no `data` do nó do React Flow: só o bloco. */
export type DadosRF = { no: No };

export const ICONE: Record<TipoNo, string> = {
  inicio: '⚡',
  mensagem: '💬',
  template: '📨',
  pergunta: '❓',
  aguardar: '⏳',
  condicao: '🔀',
  acao: '⚙️',
  randomizador: '🎲',
  ir_para: '↪️',
  fim: '🏁',
};

/** Cor da faixa do topo de cada tipo — ajuda a ler o fluxo de longe. */
export const COR: Record<TipoNo, string> = {
  inicio: '#D7F264',
  mensagem: '#7BD88F',
  template: '#7071dd',
  pergunta: '#E3F58F',
  aguardar: '#fab219',
  condicao: '#ec835a',
  acao: '#8FAEA9',
  randomizador: '#c79bf2',
  ir_para: '#6fc3df',
  fim: '#8FAEA9',
};

export const DESCRICAO_TIPO: Record<TipoNo, string> = {
  inicio: 'Onde o fluxo começa (pelo gatilho).',
  mensagem: 'Texto, mídia, botões, lista ou link.',
  template: 'Mensagem aprovada pela Meta — a única que sai fora das 24 h.',
  pergunta: 'Pergunta e guarda a resposta num campo.',
  aguardar: 'Espera minutos, horas ou dias.',
  condicao: 'Divide o caminho: sim ou não.',
  acao: 'Tag, campo, lista, avisar a equipe, pausar o robô…',
  randomizador: 'Sorteia um caminho — teste A/B.',
  ir_para: 'Continua em outro fluxo.',
  fim: 'Encerra o fluxo aqui.',
};
