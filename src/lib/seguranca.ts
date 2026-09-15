// Primitivas de assinatura usadas pelo login e pelo rastreamento de cliques.
//
// Tudo com `node:crypto` e de forma síncrona de propósito: a reescrita de links roda
// dentro da montagem do HTML, que é código puro e testável, e não vale a pena contaminá-la
// com async só para usar Web Crypto. O runtime do Next 16 é Node em todos os pontos onde
// isto é chamado — inclusive no `proxy.ts`, que desde a versão 16 roda em Node.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Segredo da aplicação. Sem ele, nada que dependa de assinatura funciona — e é melhor
 * quebrar alto no primeiro uso do que assinar com uma string vazia e achar que está seguro.
 */
export function segredo(): string {
  const s = process.env.AUTH_SECRET ?? '';
  if (s.length < 16) {
    throw new Error(
      'AUTH_SECRET ausente ou curto demais. Gere um com: openssl rand -hex 32',
    );
  }
  return s;
}

/** HMAC-SHA256 em base64url — curto o bastante para caber numa query string. */
export function assinar(valor: string, chave: string = segredo()): string {
  return createHmac('sha256', chave).update(valor).digest('base64url');
}

/**
 * Compara assinaturas em tempo constante.
 *
 * `a === b` vaza informação pelo TEMPO: a comparação para no primeiro byte diferente,
 * então um atacante mede a duração e descobre a assinatura byte a byte. Em rastreamento
 * de clique o risco é baixo; no cookie de sessão, não é.
 */
export function assinaturaConfere(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // `timingSafeEqual` exige o mesmo tamanho; tamanhos diferentes já são "não confere".
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Token opaco e imprevisível (32 bytes = 43 caracteres em base64url). */
export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
