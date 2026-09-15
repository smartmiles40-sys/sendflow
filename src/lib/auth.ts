// Login do painel.
//
// Por que isto existe: o sistema herdado não tinha autenticação NENHUMA. Qualquer
// pessoa com o endereço — um link vazado num grupo, um histórico de navegador, um
// varredor de subdomínios da Vercel — podia abrir o painel e disparar para todos os
// grupos e toda a base de e-mail. Com o motor de envio agora DENTRO do app (e não mais
// escondido atrás do n8n), isso deixou de ser um risco teórico.
//
// O desenho é deliberadamente pequeno: usuários em variável de ambiente e sessão num
// cookie assinado. Sem tabela de usuários, sem recuperação de senha, sem provedor
// externo. É uma ferramenta interna de poucas pessoas; o que precisa existir é a
// porta, não um departamento de identidade.

import { assinar, assinaturaConfere, segredo } from './seguranca';

export const COOKIE_SESSAO = 'sf_sessao';
/** Sete dias. Longo o bastante para não irritar, curto o bastante para um vazamento expirar. */
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Sessao {
  usuario: string;
  expiraEm: number;
}

/**
 * Usuários autorizados, lidos de `APP_USERS` no formato `email:senha,email2:senha2`.
 *
 * A senha fica em texto puro na variável de ambiente, e isso é uma escolha consciente:
 * guardar um hash aqui não protegeria de nada (quem lê a variável de ambiente do
 * servidor já tem o segredo da sessão e a chave do banco). O que protege é a variável
 * nunca sair do painel da hospedagem.
 */
export function usuariosConfigurados(): Map<string, string> {
  const bruto = process.env.APP_USERS ?? '';
  const mapa = new Map<string, string>();
  for (const par of bruto.split(',')) {
    const sep = par.indexOf(':');
    if (sep <= 0) continue;
    const usuario = par.slice(0, sep).trim().toLowerCase();
    const senha = par.slice(sep + 1).trim();
    if (usuario && senha) mapa.set(usuario, senha);
  }
  return mapa;
}

/** Sem `APP_USERS`, o app sobe em modo aberto — e a tela avisa disso em vermelho. */
export function loginExigido(): boolean {
  return usuariosConfigurados().size > 0;
}

/** Confere usuário e senha. Comparação em tempo constante, como no resto do projeto. */
export function credenciaisValidas(usuario: string, senha: string): boolean {
  const esperada = usuariosConfigurados().get(String(usuario ?? '').trim().toLowerCase());
  if (!esperada) return false;
  return assinaturaConfere(String(senha ?? ''), esperada);
}

/**
 * Monta o valor do cookie: `payload.assinatura`.
 *
 * O payload é legível (base64url de um JSON) — não há segredo nele. O que impede
 * forjar uma sessão é a assinatura: sem `AUTH_SECRET`, trocar o e-mail dentro do
 * payload invalida o HMAC.
 */
export function criarSessao(usuario: string, agora: Date = new Date()): string {
  const payload: Sessao = { usuario, expiraEm: agora.getTime() + VALIDADE_MS };
  const corpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

/** Valida o cookie e devolve a sessão, ou null se estiver ausente, adulterado ou vencido. */
export function lerSessao(valor: string | undefined | null, agora: Date = new Date()): Sessao | null {
  if (!valor) return null;
  const ponto = valor.lastIndexOf('.');
  if (ponto <= 0) return null;

  const corpo = valor.slice(0, ponto);
  const assinatura = valor.slice(ponto + 1);

  try {
    if (!assinaturaConfere(assinatura, assinar(corpo))) return null;
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as Sessao;
    if (!payload?.usuario || typeof payload.expiraEm !== 'number') return null;
    if (payload.expiraEm <= agora.getTime()) return null;
    // Uma sessão de usuário removido de APP_USERS morre na hora: é assim que se tira o
    // acesso de alguém que saiu da equipe, sem esperar o cookie vencer.
    if (!usuariosConfigurados().has(payload.usuario)) return null;
    return payload;
  } catch {
    // `segredo()` lança quando falta AUTH_SECRET. Sem segredo não existe sessão válida.
    return null;
  }
}

/** Atributos do cookie de sessão. */
export function opcoesCookie(producao: boolean) {
  return {
    name: COOKIE_SESSAO,
    httpOnly: true,       // fora do alcance de qualquer JavaScript da página
    sameSite: 'lax' as const, // bloqueia envio em requisição de outro site (CSRF)
    secure: producao,     // só por HTTPS; em localhost seria impossível logar
    path: '/',
    maxAge: VALIDADE_MS / 1000,
  };
}

/** `AUTH_SECRET` existe e tem tamanho aceitável? A tela de configurações mostra isso. */
export function segredoConfigurado(): boolean {
  try {
    segredo();
    return true;
  } catch {
    return false;
  }
}
