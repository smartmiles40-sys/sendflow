import { describe, it, expect } from 'vitest';
import {
  blocoPreheader,
  escaparHtml,
  htmlParaTexto,
  montarEmail,
  personalizar,
  personalizarTexto,
  primeiroNome,
  reescreverLinks,
  urlDeClique,
} from './render';

const OPCOES = { baseUrl: 'https://app.exemplo.com.br', token: 'tok123' };
const PESSOA = { nome: 'Maria Silva Santos', email: 'maria@exemplo.com', empresa: 'Acme' };

describe('primeiroNome', () => {
  it('pega só o primeiro', () => {
    expect(primeiroNome('Maria Silva Santos')).toBe('Maria');
  });
  it('nome vazio vira vazio, nunca "undefined"', () => {
    expect(primeiroNome(null)).toBe('');
    expect(primeiroNome('   ')).toBe('');
  });
});

describe('personalizar', () => {
  it('troca as variáveis conhecidas', () => {
    expect(personalizar('Oi, {{primeiro_nome}}!', PESSOA)).toBe('Oi, Maria!');
    expect(personalizar('{{empresa}}', PESSOA)).toBe('Acme');
  });
  it('é tolerante a espaço e caixa', () => {
    expect(personalizar('{{ NOME }}', PESSOA)).toBe('Maria Silva Santos');
  });
  it('variável desconhecida vira VAZIO — nunca {{plano}} na tela de quem recebe', () => {
    expect(personalizar('Seu plano: {{plano}}.', PESSOA)).toBe('Seu plano: .');
  });
  it('usa os campos livres do contato', () => {
    expect(personalizar('{{cidade}}', { ...PESSOA, campos: { cidade: 'Recife' } })).toBe('Recife');
  });
  it('preserva as variáveis estruturais para a etapa seguinte', () => {
    expect(personalizar('{{rodape}}', PESSOA)).toBe('{{rodape}}');
    expect(personalizar('{{descadastro}}', PESSOA)).toBe('{{descadastro}}');
  });
  it('escapa o valor: um "&" no nome da empresa não pode quebrar a marcação', () => {
    expect(personalizar('{{empresa}}', { ...PESSOA, empresa: 'Silva & Cia' })).toBe('Silva &amp; Cia');
  });
  it('um nome importado com HTML não vira HTML no e-mail', () => {
    const saida = personalizar('{{nome}}', { ...PESSOA, nome: '<script>alert(1)</script>' });
    expect(saida).not.toContain('<script>');
    expect(saida).toContain('&lt;script&gt;');
  });
});

describe('personalizarTexto', () => {
  it('NÃO escapa: o assunto não é HTML', () => {
    // Escapar aqui deixaria "Tudo &amp; mais" na linha de assunto da caixa de entrada.
    expect(personalizarTexto('{{empresa}} & você', { ...PESSOA, empresa: 'Silva & Cia' })).toBe(
      'Silva & Cia & você',
    );
  });
});

describe('escaparHtml', () => {
  it('escapa os quatro caracteres que quebram marcação', () => {
    expect(escaparHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('reescreverLinks', () => {
  it('faz o link passar pelo redirecionador, com assinatura', () => {
    const saida = reescreverLinks('<a href="https://site.com/oferta">ver</a>', OPCOES);
    expect(saida).toContain('/api/e/c/tok123?u=');
    expect(saida).toContain('&s=');
  });

  it('a assinatura confere com a que urlDeClique gera', () => {
    const esperado = urlDeClique(OPCOES.baseUrl, OPCOES.token, 'https://site.com/oferta');
    expect(reescreverLinks('<a href="https://site.com/oferta">x</a>', OPCOES)).toContain(esperado);
  });

  it('URLs diferentes geram assinaturas diferentes — é o que fecha o redirecionador aberto', () => {
    const a = urlDeClique(OPCOES.baseUrl, OPCOES.token, 'https://site.com/a');
    const b = urlDeClique(OPCOES.baseUrl, OPCOES.token, 'https://site.com/b');
    expect(new URL(a).searchParams.get('s')).not.toBe(new URL(b).searchParams.get('s'));
  });

  it('não rastreia mailto, tel nem âncora', () => {
    const html = '<a href="mailto:x@y.com">m</a><a href="tel:+5511">t</a><a href="#topo">a</a>';
    expect(reescreverLinks(html, OPCOES)).toBe(html);
  });

  it('não rastreia javascript: (nem que alguém cole no editor)', () => {
    const html = '<a href="javascript:alert(1)">x</a>';
    expect(reescreverLinks(html, OPCOES)).toBe(html);
  });

  it('não reescreve um link que já é nosso', () => {
    const html = `<a href="${OPCOES.baseUrl}/api/e/u/tok123">sair</a>`;
    expect(reescreverLinks(html, OPCOES)).toBe(html);
  });

  it('desfaz &amp; antes de assinar, senão o destino sai errado', () => {
    const saida = reescreverLinks('<a href="https://s.com/?a=1&amp;b=2">x</a>', OPCOES);
    const url = new URL(saida.match(/href="([^"]+)"/)![1]);
    const destino = Buffer.from(url.searchParams.get('u')!, 'base64url').toString('utf8');
    expect(destino).toBe('https://s.com/?a=1&b=2');
  });
});

describe('blocoPreheader', () => {
  it('fica invisível e escapa o texto', () => {
    const bloco = blocoPreheader('Olha & confere');
    expect(bloco).toContain('display:none');
    expect(bloco).toContain('Olha &amp; confere');
  });
});

describe('htmlParaTexto', () => {
  it('transforma parágrafos em quebras de linha', () => {
    expect(htmlParaTexto('<p>Um</p><p>Dois</p>')).toBe('Um\nDois');
  });
  it('mostra o endereço do link, que em texto puro não aparece sozinho', () => {
    expect(htmlParaTexto('<a href="https://x.com">clique</a>')).toBe('clique (https://x.com)');
  });
  it('tira estilo e script', () => {
    expect(htmlParaTexto('<style>p{color:red}</style><p>ok</p>')).toBe('ok');
  });
  it('não deixa o preheader invisível vazar para a versão em texto', () => {
    const html = `${blocoPreheader('escondido')}<p>visível</p>`;
    expect(htmlParaTexto(html)).toBe('visível');
  });
});

describe('montarEmail', () => {
  const html = '<p>Oi, {{primeiro_nome}}!</p><a href="https://site.com">ver</a><div>{{rodape}}</div>';

  it('personaliza, rastreia e injeta o pixel', () => {
    const r = montarEmail(html, 'Oi {{primeiro_nome}}', PESSOA, OPCOES);
    expect(r.html).toContain('Oi, Maria!');
    expect(r.html).toContain('/api/e/c/tok123?u=');
    expect(r.html).toContain('/api/e/o/tok123.png');
    expect(r.assunto).toBe('Oi Maria');
  });

  it('o link de descadastro NÃO é rastreado — quem está saindo não vira engajamento', () => {
    const r = montarEmail(html, 'x', PESSOA, OPCOES);
    expect(r.html).toContain(`${OPCOES.baseUrl}/api/e/u/tok123`);
    expect(r.urlDescadastro).toBe(`${OPCOES.baseUrl}/api/e/u/tok123`);
  });

  it('acrescenta um rodapé com descadastro mesmo quando o modelo não declara {{rodape}}', () => {
    // E-mail de marketing sem saída visível é reclamação de spam garantida.
    const r = montarEmail('<p>sem rodape</p>', 'x', PESSOA, OPCOES);
    expect(r.html).toContain('/api/e/u/tok123');
  });

  it('rastrear: false não injeta pixel nem reescreve link', () => {
    const r = montarEmail(html, 'x', PESSOA, { ...OPCOES, rastrear: false });
    expect(r.html).not.toContain('/api/e/o/');
    expect(r.html).toContain('href="https://site.com"');
  });

  it('gera a versão em texto junto', () => {
    const r = montarEmail(html, 'x', PESSOA, OPCOES);
    expect(r.texto).toContain('Oi, Maria!');
  });

  it('inclui o preheader quando existe', () => {
    const r = montarEmail(html, 'x', PESSOA, { ...OPCOES, preheader: 'Olá {{primeiro_nome}}' });
    expect(r.html).toContain('Olá Maria');
    expect(r.html.indexOf('Olá Maria')).toBeLessThan(r.html.indexOf('Oi, Maria!'));
  });
});
