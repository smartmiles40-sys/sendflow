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

/**
 * A instância da Evolution desta conexão, ou `null` quando não há.
 *
 * Desde a 0019 `instance_name` é nulo nas conexões da API oficial — elas não têm
 * instância nem QR Code, e tudo que é "aparelho" (ler conversas, sincronizar grupos,
 * reconectar) simplesmente não existe lá. Este atalho é o que faz o compilador cobrar
 * a verificação em cada rota que fala com um aparelho.
 */
export function instanciaDe(conexao: {
  provider?: string;
  instance_name?: string | null;
}): string | null {
  if (conexao.provider && conexao.provider !== 'evolution') return null;
  return conexao.instance_name || null;
}

/** A frase que a tela mostra quando a rota de aparelho recebe um número oficial. */
export const SEM_INSTANCIA =
  'Esta conexão é um número da API oficial da Meta. QR Code, grupos e conversas só existem em número conectado por chip.';
