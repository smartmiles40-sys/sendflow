/**
 * A URL pública do app.
 *
 * Importa mais do que parece: ela vai embutida no pixel de abertura, em cada link
 * rastreado e no link de descadastro de CADA e-mail enviado. Se estiver errada no
 * momento do envio, a campanha sai com links quebrados e não há como consertar depois —
 * o e-mail já está na caixa das pessoas.
 *
 * Ordem de preferência:
 *   1. APP_URL           — o domínio definitivo, definido à mão. Sempre o certo.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — o domínio de produção do projeto na Vercel.
 *   3. VERCEL_URL        — a URL desta implantação. Serve de rede de segurança, mas
 *                          muda a cada deploy: links de campanhas antigas param de
 *                          funcionar. Por isso a tela de configurações alerta quando
 *                          APP_URL não está definida.
 */
export function urlPublica(): string {
  const explicita = (process.env.APP_URL ?? '').trim();
  if (explicita) return explicita.replace(/\/+$/, '');

  const producao = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();
  if (producao) return `https://${producao.replace(/\/+$/, '')}`;

  const deploy = (process.env.VERCEL_URL ?? '').trim();
  if (deploy) return `https://${deploy.replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}

/** APP_URL está definida? A tela de configurações usa isso para avisar. */
export function urlPublicaEstavel(): boolean {
  return Boolean((process.env.APP_URL ?? '').trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim());
}
