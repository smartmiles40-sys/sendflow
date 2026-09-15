/**
 * IP de origem da requisição, atrás de proxy (Vercel, Cloudflare, Nginx).
 *
 * `x-forwarded-for` é uma lista: o primeiro item é o cliente e os seguintes são os
 * proxies pelos quais passou. Guardamos só para depurar abuso de rastreamento (mil
 * aberturas do mesmo IP em dois minutos é robô, não interesse).
 */
export function ipDaRequisicao(req: Request): string | null {
  const encaminhado = req.headers.get('x-forwarded-for');
  if (encaminhado) return encaminhado.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}
