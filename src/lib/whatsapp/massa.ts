// As regras puras do disparo em massa pela API oficial.
//
// Duas coisas moram aqui, e as duas são pequenas de propósito — é o tipo de código que
// precisa ser óbvio e testável, porque roda 50 mil vezes por campanha:
//
//   1. resolver as variáveis do template para CADA pessoa;
//   2. reconhecer um pedido de saída ("PARAR") na resposta de quem recebeu.

import { personalizarTexto, type DadosPessoa } from '../email/render';

// ── 1. Variáveis do template ─────────────────────────────────────────────────────

/**
 * O que a campanha guarda em `template_variaveis`: posição → texto, onde o texto
 * ainda pode conter os marcadores de personalização do sistema.
 *
 *   { "1": "{{primeiro_nome}}", "2": "Japão & China" }
 *
 * A posição é a da Meta (`{{1}}`, `{{2}}`), e o conteúdo é o nosso dialeto. Misturar os
 * dois num campo só é proposital: quem escreve a campanha já conhece `{{primeiro_nome}}`
 * do e-mail e não precisa aprender um segundo jeito de personalizar.
 */
export type MapaVariaveis = Record<string, string>;

/**
 * A Meta recusa (132012) parâmetro com quebra de linha, tabulação ou mais de quatro
 * espaços seguidos. Um nome colado de planilha com `"  Maria\n"` derrubaria a linha
 * inteira da fila — e o erro só apareceria com a campanha já em voo.
 */
export function limparParametro(valor: string): string {
  return String(valor ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
}

export interface ContatoParaTemplate {
  nome?: string | null;
  email?: string | null;
  empresa?: string | null;
  campos?: Record<string, string> | null;
}

/**
 * Resolve o mapa para o array ORDENADO que a Cloud API espera.
 *
 * Duas decisões que evitam erro de disparo:
 *   • a ordem é numérica pela chave, não a ordem do objeto — `{"10":…,"2":…}` em JSON
 *     não garante ordem nenhuma, e um parâmetro trocado manda "Japão" no lugar do nome;
 *   • posição vazia vira string vazia em vez de sumir, porque a Meta conta POSIÇÕES:
 *     mandar 2 parâmetros num template de 3 é erro 132000 para a campanha toda.
 */
export function resolverVariaveis(
  mapa: MapaVariaveis | null | undefined,
  contato: ContatoParaTemplate,
  quantidade?: number,
): string[] {
  const entradas = Object.entries(mapa ?? {})
    .map(([chave, valor]) => [Number(chave), valor] as const)
    .filter(([pos]) => Number.isInteger(pos) && pos >= 1);

  const total = quantidade ?? (entradas.length ? Math.max(...entradas.map(([p]) => p)) : 0);
  if (total <= 0) return [];

  const pessoa: DadosPessoa = {
    nome: contato.nome ?? null,
    email: contato.email ?? '',
    empresa: contato.empresa ?? null,
    campos: contato.campos ?? undefined,
  };

  const porPosicao = new Map(entradas);
  const resolvidas: string[] = [];
  for (let pos = 1; pos <= total; pos += 1) {
    const modelo = porPosicao.get(pos) ?? '';
    resolvidas.push(limparParametro(personalizarTexto(modelo, pessoa)));
  }
  return resolvidas;
}

/**
 * Uma prévia do que a pessoa vai ver, para a tela conferir ANTES de disparar.
 * Troca os `{{n}}` do corpo do template pelos valores já resolvidos.
 */
export function preverTemplate(corpo: string, valores: string[]): string {
  return String(corpo ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (inteiro, n: string) => {
    const valor = valores[Number(n) - 1];
    return valor === undefined ? inteiro : valor;
  });
}

// ── 2. Opt-out ───────────────────────────────────────────────────────────────────

/**
 * Palavras que significam "não me mande mais".
 *
 * Por que isto não é firula: a denúncia de quem não consegue sair é a causa nº 1 da
 * queda de qualidade do número na Meta, e a qualidade é quem define o teto diário. Um
 * opt-out que funciona é mais barato que qualquer aumento de tier.
 *
 * A lista inclui o que as pessoas realmente escrevem, não só o que os manuais mandam
 * escrever. A Meta trata "STOP" nativamente em alguns países; no Brasil, não.
 */
const PEDIDOS_DE_PARADA = [
  'parar',
  'pare',
  'sair',
  'cancelar',
  'descadastrar',
  'remover',
  'stop',
  'unsubscribe',
  'nao quero',
  'não quero',
  'nao quero mais',
  'não quero mais',
  'me tira',
  'me tire',
  'me remove',
  'me remova',
  'para de mandar',
  'pare de mandar',
];

/**
 * A resposta é um pedido de saída?
 *
 * A comparação é sobre a mensagem INTEIRA, sem acento e sem pontuação, e só até 40
 * caracteres. "PARAR" vira opt-out; "não quero perder a data, me manda o link" NÃO —
 * descadastrar alguém animado por causa de um "não quero" no meio da frase é pior do
 * que deixar passar um pedido legítimo, que a pessoa repete.
 */
export function ehPedidoDeParada(texto: string): boolean {
  const limpo = String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!limpo || limpo.length > 40) return false;

  return PEDIDOS_DE_PARADA.some((frase) => {
    const alvo = frase
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return limpo === alvo || limpo.startsWith(`${alvo} `);
  });
}
