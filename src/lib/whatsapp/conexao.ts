import { urlPublica } from '../url';

/**
 * Nome da instância na Evolution a partir do nome que a pessoa deu.
 *
 * O sufixo aleatório não é paranoia: se alguém apagar a conexão aqui e criar outra com
 * o mesmo rótulo, a instância antiga pode ainda existir do lado da Evolution — e
 * reaproveitar o nome faria a conexão nova herdar uma sessão velha, possivelmente de
 * outro número.
 */
export function nomeDeInstancia(
  nome: string,
  sufixo = Math.random().toString(36).slice(2, 7),
): string {
  const base = String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'conexao'}-${sufixo}`;
}

/**
 * URL que a Evolution vai chamar a cada evento.
 *
 * O segredo vai na query string porque a Evolution não permite configurar cabeçalho no
 * webhook — então a própria URL é a credencial. Por isso ela nunca é exibida na
 * interface nem gravada no banco: é montada na hora, a partir do ambiente.
 */
export function urlDoWebhook(): string {
  const segredo = (process.env.WEBHOOK_SECRET ?? '').trim();
  const base = `${urlPublica()}/api/webhooks/evolution`;
  return segredo ? `${base}?s=${encodeURIComponent(segredo)}` : base;
}
