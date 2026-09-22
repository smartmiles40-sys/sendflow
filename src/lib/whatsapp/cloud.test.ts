import { describe, it, expect } from 'vitest';
import { contarVariaveis, montarComponentes, normalizarTemplate } from './cloud';

describe('contarVariaveis', () => {
  it('conta pela MAIOR posição, não pela quantidade de ocorrências', () => {
    // A Meta numera as posições; `{{1}} … {{1}} … {{3}}` pede TRÊS parâmetros.
    expect(contarVariaveis('Oi {{1}}, tudo bem {{1}}? Vaga até {{3}}.')).toBe(3);
  });
  it('texto sem variável é zero', () => {
    expect(contarVariaveis('Sua vaga está confirmada.')).toBe(0);
  });
  it('tolera espaço dentro das chaves', () => {
    expect(contarVariaveis('Oi {{ 2 }}')).toBe(2);
  });
});

describe('montarComponentes', () => {
  const base = { para: '5511999999999', template: 'boas_vindas', idioma: 'pt_BR' };

  it('template sem variável não manda components', () => {
    expect(montarComponentes(base)).toEqual([]);
  });

  it('corpo vira um bloco body com os parâmetros na ordem', () => {
    expect(montarComponentes({ ...base, variaveisCorpo: ['Maria', 'Japão'] })).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maria' },
          { type: 'text', text: 'Japão' },
        ],
      },
    ]);
  });

  it('cabeçalho de imagem vira bloco header com link', () => {
    const c = montarComponentes({
      ...base,
      tipoCabecalho: 'IMAGE',
      midiaCabecalhoUrl: 'https://exemplo.com/a.jpg',
    });
    expect(c[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { link: 'https://exemplo.com/a.jpg' } }],
    });
  });

  it('cabeçalho de documento leva filename — sem ele o anexo chega sem nome', () => {
    const c = montarComponentes({
      ...base,
      tipoCabecalho: 'DOCUMENT',
      midiaCabecalhoUrl: 'https://exemplo.com/roteiro.pdf',
      nomeArquivo: 'roteiro.pdf',
    });
    expect(c[0]).toMatchObject({
      parameters: [{ type: 'document', document: { filename: 'roteiro.pdf' } }],
    });
  });

  it('cabeçalho de texto usa as variáveis do cabeçalho, não as do corpo', () => {
    const c = montarComponentes({
      ...base,
      tipoCabecalho: 'TEXT',
      variaveisCabecalho: ['Japão'],
      variaveisCorpo: ['Maria'],
    });
    expect(c).toHaveLength(2);
    expect(c[0]).toEqual({ type: 'header', parameters: [{ type: 'text', text: 'Japão' }] });
    expect(c[1]).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'Maria' }] });
  });

  it('cabeçalho de mídia sem URL é ignorado em vez de mandar link vazio', () => {
    expect(montarComponentes({ ...base, tipoCabecalho: 'IMAGE', midiaCabecalhoUrl: null })).toEqual([]);
  });
});

describe('normalizarTemplate', () => {
  const bruto = {
    id: '123',
    name: 'live_japao',
    status: 'approved',
    category: 'marketing',
    language: 'pt_BR',
    components: [
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Oi {{1}}, a live do {{2}} começa hoje.' },
      { type: 'FOOTER', text: 'Responda PARAR para sair.' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Entrar' }] },
    ],
  };

  it('extrai corpo, cabeçalho, rodapé e botões', () => {
    const t = normalizarTemplate(bruto);
    expect(t.nome).toBe('live_japao');
    expect(t.cabecalho_tipo).toBe('IMAGE');
    expect(t.corpo).toContain('a live do {{2}}');
    expect(t.rodape).toBe('Responda PARAR para sair.');
    expect(t.botoes).toHaveLength(1);
  });

  it('normaliza status e categoria para MAIÚSCULA', () => {
    const t = normalizarTemplate(bruto);
    expect(t.status).toBe('APPROVED');
    expect(t.categoria).toBe('MARKETING');
  });

  it('conta as variáveis do corpo', () => {
    expect(normalizarTemplate(bruto).variaveis_corpo).toBe(2);
  });

  it('cabeçalho de mídia não tem variável de texto', () => {
    expect(normalizarTemplate(bruto).variaveis_cabecalho).toBe(0);
  });

  it('cabeçalho de texto com variável é contado', () => {
    const t = normalizarTemplate({
      ...bruto,
      components: [{ type: 'HEADER', format: 'TEXT', text: 'Turma {{1}}' }],
    });
    expect(t.cabecalho_tipo).toBe('TEXT');
    expect(t.cabecalho_texto).toBe('Turma {{1}}');
    expect(t.variaveis_cabecalho).toBe(1);
  });

  it('template sem components não quebra', () => {
    const t = normalizarTemplate({ name: 'vazio' });
    expect(t.corpo).toBe('');
    expect(t.cabecalho_tipo).toBeNull();
  });
});
