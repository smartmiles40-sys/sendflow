// Montagem do e-mail que sai: personalização, rodapé, pixel de abertura e links rastreados.
//
// É aqui que nascem os KPIs de e-mail. O provedor (Resend, SMTP) só entrega o envelope;
// quem sabe QUEM abriu e QUEM clicou é este arquivo, porque foi ele que carimbou o token
// da pessoa no pixel e em cada link antes de mandar.
//
// Tudo síncrono e sem I/O — dá para testar o HTML final inteiro sem subir servidor.

import { assinar } from '../seguranca';

export interface DadosPessoa {
  nome?: string | null;
  email: string;
  empresa?: string | null;
  /** Campos livres do contato: {{cidade}}, {{plano}}… */
  campos?: Record<string, string>;
}

export interface OpcoesRender {
  /** URL pública do app, sem barra no fim. Ex.: https://sendflow.vercel.app */
  baseUrl: string;
  /** Token do destinatário NESTA campanha. */
  token: string;
  /** Rastrear abertura (pixel) e cliques (redirecionamento assinado). */
  rastrear?: boolean;
  preheader?: string | null;
  rodapeTexto?: string | null;
  rodapeEndereco?: string | null;
}

// ── Personalização ───────────────────────────────────────────────────────────────

/** `"Maria Silva Santos"` → `"Maria"`. Vazio devolve vazio (nunca "undefined"). */
export function primeiroNome(nome: string | null | undefined): string {
  const n = String(nome ?? '').trim();
  if (!n) return '';
  return n.split(/\s+/)[0];
}

/**
 * Troca `{{variavel}}` pelos dados da pessoa. Tolerante a espaço e caixa:
 * `{{ Nome }}` e `{{NOME}}` funcionam igual.
 *
 * Variável desconhecida vira string VAZIA, não fica como `{{plano}}` na tela — um
 * e-mail com "Olá {{nome}}," visível é o erro mais constrangedor deste tipo de sistema.
 * As variáveis estruturais ({{rodape}}, {{descadastro}}) são preservadas: quem as troca
 * é a etapa seguinte.
 */
const ESTRUTURAIS = new Set(['rodape', 'descadastro', 'preheader']);

export function personalizar(texto: string, pessoa: DadosPessoa): string {
  const mapa: Record<string, string> = {
    nome: pessoa.nome?.trim() || '',
    primeiro_nome: primeiroNome(pessoa.nome),
    email: pessoa.email,
    empresa: pessoa.empresa?.trim() || '',
    ...Object.fromEntries(
      Object.entries(pessoa.campos ?? {}).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
    ),
  };
  return String(texto ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (inteiro, chaveBruta: string) => {
    const chave = chaveBruta.trim().toLowerCase();
    if (ESTRUTURAIS.has(chave)) return inteiro;
    return chave in mapa ? escaparHtml(mapa[chave]) : '';
  });
}

/**
 * Escapa o que vem do contato antes de entrar no HTML.
 *
 * Um nome cadastrado como `<script>` ou, mais realista, uma empresa chamada
 * `Silva & Cia` quebraria a marcação. Não é sobre desconfiar do contato — é que o dado
 * veio de uma importação de CSV que ninguém revisou.
 */
export function escaparHtml(valor: string): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Links rastreados ─────────────────────────────────────────────────────────────

/**
 * URL de redirecionamento de clique, ASSINADA.
 *
 * A assinatura não é firula: sem ela, `/api/e/c/<token>?u=<qualquer-coisa>` transforma
 * o nosso domínio num redirecionador aberto — o presente perfeito para quem monta
 * phishing ("o link começa com o domínio deles, então é seguro"). Com HMAC, só
 * redireciona para URL que este servidor gerou.
 */
export function urlDeClique(baseUrl: string, token: string, destino: string): string {
  const alvo = Buffer.from(destino, 'utf8').toString('base64url');
  const assinatura = assinar(`${token}.${alvo}`);
  return `${baseUrl}/api/e/c/${encodeURIComponent(token)}?u=${alvo}&s=${assinatura}`;
}

export function urlDoPixel(baseUrl: string, token: string): string {
  return `${baseUrl}/api/e/o/${encodeURIComponent(token)}.png`;
}

export function urlDeDescadastro(baseUrl: string, token: string): string {
  return `${baseUrl}/api/e/u/${encodeURIComponent(token)}`;
}

/** Protocolos que não são clique rastreável: não adianta (e quebraria o link). */
const NAO_RASTREAR = /^(mailto:|tel:|sms:|#|\{\{|data:|javascript:)/i;

/**
 * Reescreve os `href` do HTML para passarem pelo nosso redirecionador.
 *
 * Preserva o link de descadastro fora do rastreamento de propósito: quem está saindo
 * não precisa ter o clique contabilizado como engajamento, e um descadastro que falha
 * porque o rastreador caiu é problema jurídico, não só de métrica.
 */
export function reescreverLinks(html: string, opcoes: OpcoesRender): string {
  const { baseUrl, token } = opcoes;
  return html.replace(/href\s*=\s*(["'])(.*?)\1/gi, (inteiro, aspas: string, url: string) => {
    const limpa = url.trim();
    if (!limpa || NAO_RASTREAR.test(limpa)) return inteiro;
    if (limpa.startsWith(`${baseUrl}/api/e/`)) return inteiro; // já é nosso
    if (!/^https?:\/\//i.test(limpa)) return inteiro; // relativo não faz sentido em e-mail
    return `href=${aspas}${urlDeClique(baseUrl, token, decodeEntidades(limpa))}${aspas}`;
  });
}

/** `&amp;` dentro de um href é entidade HTML; a URL real tem `&`. */
function decodeEntidades(url: string): string {
  return url.replace(/&amp;/g, '&');
}

// ── Peças do e-mail ──────────────────────────────────────────────────────────────

/**
 * O preheader: o trecho que a caixa de entrada mostra depois do assunto.
 *
 * Sem ele, o Gmail preenche com o primeiro texto do e-mail — que costuma ser
 * "Não consegue ver? Abra no navegador". A sequência de caracteres invisíveis no fim
 * empurra o resto do conteúdo para fora da prévia; é o truque padrão do mercado.
 */
export function blocoPreheader(preheader: string): string {
  const preenchimento = '&#8199;&#65279;&nbsp;'.repeat(60);
  return (
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;` +
    `mso-hide:all;font-size:1px;line-height:1px;color:transparent;">` +
    `${escaparHtml(preheader)}${preenchimento}</div>`
  );
}

/** Rodapé com descadastro. Obrigatório na prática: sem ele, a marcação de spam sobe. */
export function blocoRodape(opcoes: OpcoesRender): string {
  const link = urlDeDescadastro(opcoes.baseUrl, opcoes.token);
  const partes = [
    opcoes.rodapeTexto ? escaparHtml(opcoes.rodapeTexto) : '',
    opcoes.rodapeEndereco ? escaparHtml(opcoes.rodapeEndereco) : '',
    `<a href="${link}" style="color:inherit;text-decoration:underline;">Descadastrar meu e-mail</a>`,
  ].filter(Boolean);
  return partes.join('<br>');
}

/** Pixel de abertura. Vai no fim do corpo, onde é mais provável que o cliente carregue. */
export function blocoPixel(opcoes: OpcoesRender): string {
  return (
    `<img src="${urlDoPixel(opcoes.baseUrl, opcoes.token)}" width="1" height="1" ` +
    `alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`
  );
}

// ── HTML → texto ─────────────────────────────────────────────────────────────────

/**
 * Versão em texto puro a partir do HTML.
 *
 * Não é enfeite: e-mail só-HTML é sinal clássico de spam, e alguns clientes (relógio,
 * leitor de tela, modo economia) mostram só esta parte. Derivar automaticamente é bem
 * melhor do que não mandar nada.
 */
export function htmlParaTexto(html: string): string {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // O que é invisível no HTML (preheader, pixel) não deve aparecer no texto.
    .replace(/<div[^>]*display:\s*none[\s\S]*?<\/div>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    // Um link vira "texto (url)": em texto puro, o endereço precisa estar visível.
    .replace(/<a[^>]*href\s*=\s*["'](.*?)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, url, texto) => {
      const limpo = String(texto).replace(/<[^>]+>/g, '').trim();
      return limpo ? `${limpo} (${url})` : String(url);
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8199;|&#65279;/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Montagem final ───────────────────────────────────────────────────────────────

export interface EmailMontado {
  html: string;
  texto: string;
  assunto: string;
  urlDescadastro: string;
}

/**
 * Pega o HTML da campanha e devolve o e-mail exato que vai para UMA pessoa.
 *
 * Ordem das etapas, que importa:
 *   1. personalizar  — troca {{nome}} e afins, escapando o valor.
 *   2. rodapé        — só agora, porque o rodapé traz um link que precisa existir
 *                      antes da etapa 3 decidir o que rastrear.
 *   3. links         — reescreve os href (o de descadastro fica de fora).
 *   4. preheader/pixel — pedaços nossos, que não devem ser reescritos por 1–3.
 */
export function montarEmail(
  htmlBruto: string,
  assuntoBruto: string,
  pessoa: DadosPessoa,
  opcoes: OpcoesRender,
): EmailMontado {
  const rastrear = opcoes.rastrear !== false;

  let html = personalizar(htmlBruto, pessoa);
  const rodape = blocoRodape(opcoes);
  html = html
    .replace(/\{\{\s*rodape\s*\}\}/gi, rodape)
    .replace(/\{\{\s*descadastro\s*\}\}/gi, urlDeDescadastro(opcoes.baseUrl, opcoes.token));

  // Nenhum modelo declarou onde fica o rodapé: acrescenta um, porque e-mail de marketing
  // sem saída visível é reclamação de spam garantida.
  if (!/\{\{\s*rodape\s*\}\}/i.test(htmlBruto) && !html.includes('e/u/')) {
    html += `<div style="margin:24px auto;max-width:600px;padding:0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8d96ad;text-align:center;">${rodape}</div>`;
  }

  if (rastrear) html = reescreverLinks(html, opcoes);

  const preheader = opcoes.preheader ? personalizar(opcoes.preheader, pessoa) : '';
  const abertura = preheader ? blocoPreheader(preheader) : '';
  const fechamento = rastrear ? blocoPixel(opcoes) : '';
  html = `${abertura}${html}${fechamento}`;

  return {
    html,
    texto: htmlParaTexto(html),
    assunto: personalizarTexto(assuntoBruto, pessoa),
    urlDescadastro: urlDeDescadastro(opcoes.baseUrl, opcoes.token),
  };
}

/**
 * Personalização para lugares que NÃO são HTML (assunto, versão texto).
 * Escapar aqui deixaria `Tudo &amp; mais` na linha de assunto.
 */
export function personalizarTexto(texto: string, pessoa: DadosPessoa): string {
  const mapa: Record<string, string> = {
    nome: pessoa.nome?.trim() || '',
    primeiro_nome: primeiroNome(pessoa.nome),
    email: pessoa.email,
    empresa: pessoa.empresa?.trim() || '',
    ...Object.fromEntries(
      Object.entries(pessoa.campos ?? {}).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
    ),
  };
  return String(texto ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (inteiro, chaveBruta: string) => {
    const chave = chaveBruta.trim().toLowerCase();
    if (ESTRUTURAIS.has(chave)) return inteiro;
    return chave in mapa ? mapa[chave] : '';
  });
}
