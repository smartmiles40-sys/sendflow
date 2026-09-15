// Endereçamento do WhatsApp — a camada que fala "para onde" com a Evolution.
//
// Três dialetos convivem aqui e é preciso aceitar os três na entrada:
//   • JID nativo do WhatsApp:  120363021234567890@g.us  (grupo)  |  5511999999999@s.whatsapp.net
//   • Herança do Z-API:        120363021234567890-group
//   • O que a pessoa digita:   (11) 99999-9999  |  +55 11 99999-9999
// Na saída, um formato só: o que a Evolution entende.

/** Sufixo de grupo no WhatsApp. Um JID que termina nisso é sempre um grupo. */
const SUFIXO_GRUPO = '@g.us';
const SUFIXO_CONTATO = '@s.whatsapp.net';

/** Um destino é grupo? Cobre o JID nativo e o formato antigo do Z-API. */
export function ehGrupo(destino: string): boolean {
  const d = destino.trim();
  return d.endsWith(SUFIXO_GRUPO) || /-group$/i.test(d);
}

/**
 * Normaliza qualquer um dos dialetos para o endereço que a Evolution aceita.
 *
 * Grupo  → `120363…@g.us`
 * Número → só dígitos com DDI (`5511999999999`), que é como a Evolution quer o `number`.
 *
 * Devolve string vazia quando não sobra nada aproveitável — o chamador trata isso como
 * destino inválido em vez de mandar lixo para a API.
 */
export function normalizarDestino(destino: string): string {
  const d = String(destino ?? '').trim();
  if (!d) return '';

  if (ehGrupo(d)) {
    // Fica só o identificador numérico do grupo, venha ele de qual dialeto vier.
    const id = d.replace(SUFIXO_GRUPO, '').replace(/-group$/i, '').trim();
    return id ? `${id}${SUFIXO_GRUPO}` : '';
  }

  const semSufixo = d.replace(SUFIXO_CONTATO, '');
  return somenteDigitos(semSufixo);
}

/** Tira tudo que não é dígito. `+55 (11) 99999-9999` → `5511999999999`. */
export function somenteDigitos(valor: string): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * Normaliza um telefone brasileiro para o formato E.164 sem o `+`, que é o que o
 * WhatsApp usa como identidade da conta.
 *
 * Regras aplicadas, nesta ordem:
 *   • 10 ou 11 dígitos (DDD + número, como se digita no Brasil) → prefixa 55.
 *   • 12 ou 13 dígitos começando em 55 → já está pronto.
 *   • Qualquer outro tamanho → devolve como veio, só com dígitos. Números de fora do
 *     Brasil são legítimos e não cabe adivinhar o DDI deles.
 *
 * O nono dígito NÃO é inventado aqui de propósito: um celular antigo de 8 dígitos
 * existe no WhatsApp com o número que a operadora deu, e "consertar" isso já custou
 * mensagem entregue no vazio antes.
 */
export function normalizarTelefoneBR(valor: string): string {
  const d = somenteDigitos(valor);
  if (!d) return '';
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

/** Formato humano para a tela: `5511999999999` → `+55 11 99999-9999`. */
export function formatarTelefone(valor: string): string {
  const d = somenteDigitos(valor);
  if (d.length === 13 && d.startsWith('55')) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith('55')) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return d ? `+${d}` : '';
}

/** Um telefone plausível para o WhatsApp: DDI + DDD + número, de 10 a 15 dígitos. */
export function telefoneValido(valor: string): boolean {
  const d = somenteDigitos(valor);
  return d.length >= 10 && d.length <= 15;
}
