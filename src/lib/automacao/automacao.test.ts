import { describe, it, expect } from 'vitest';
import {
  avaliarCondicao,
  calcularAcordar,
  casaPalavraChave,
  codigoDeReferencia,
  escolherVariante,
  lerEntrada,
  lerIdDeResposta,
  linkDeReferencia,
  montarMensagens,
  montarPergunta,
  personalizar,
  prefixoDeResposta,
  validarResposta,
} from './montar';
import { grafoInicial, janelaAberta, noPadrao, saidasDoNo, validarGrafo, type Grafo, type No } from './tipos';
import { MODELOS } from './modelos';
import { montarComponentes } from '../whatsapp/cloud';

const pessoa = { nome: 'Maria Silva', email: 'm@x.com', telefone: '5511999990000', campos: { destino: 'Japão' } };

describe('personalizar', () => {
  it('troca variáveis do sistema e campos personalizados', () => {
    expect(personalizar('Oi {{primeiro_nome}}, {{ destino }}!', pessoa)).toBe('Oi Maria, Japão!');
  });
  it('variável desconhecida vira vazio, nunca aparece crua', () => {
    expect(personalizar('Plano: {{plano}}.', pessoa)).toBe('Plano: .');
  });
  it('não escapa HTML (WhatsApp é texto puro)', () => {
    expect(personalizar('{{nome}}', { nome: 'Silva & Cia' })).toBe('Silva & Cia');
  });
});

describe('montarMensagens', () => {
  it('texto simples + imagem saem em ordem', () => {
    const c = montarMensagens(
      {
        blocos: [
          { tipo: 'texto', texto: 'Oi {{primeiro_nome}}' },
          { tipo: 'imagem', url: 'https://x.com/a.jpg', legenda: 'Foto' },
        ],
        interacao: { tipo: 'nenhuma' },
      },
      pessoa,
    );
    expect(c).toEqual([
      { type: 'text', text: { body: 'Oi Maria', preview_url: false } },
      { type: 'image', image: { link: 'https://x.com/a.jpg', caption: 'Foto' } },
    ]);
  });

  it('botões vão presos ao ÚLTIMO texto, com o id endereçado', () => {
    const c = montarMensagens(
      {
        blocos: [
          { tipo: 'texto', texto: 'Primeiro' },
          { tipo: 'texto', texto: 'Escolha:' },
        ],
        interacao: { tipo: 'botoes', botoes: [{ id: 'b1', titulo: 'Japão' }] },
        rodape: 'STFV',
      },
      pessoa,
      'f:abc:n1:',
    );
    expect(c).toHaveLength(2);
    expect(c[1]).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Escolha:' },
        footer: { text: 'STFV' },
        action: { buttons: [{ type: 'reply', reply: { id: 'f:abc:n1:b1', title: 'Japão' } }] },
      },
    });
  });

  it('lista vira interactive list com seções', () => {
    const [c] = montarMensagens(
      {
        blocos: [{ tipo: 'texto', texto: 'Quando?' }],
        interacao: { tipo: 'lista', rotuloBotao: 'Ver', secoes: [{ titulo: '', itens: [{ id: 'i1', titulo: 'Já' }] }] },
      },
      pessoa,
    );
    expect(c).toMatchObject({ interactive: { type: 'list', action: { button: 'Ver', sections: [{ rows: [{ id: 'i1', title: 'Já' }] }] } } });
  });

  it('áudio não leva legenda (a Meta recusa)', () => {
    const [c] = montarMensagens(
      { blocos: [{ tipo: 'audio', url: 'https://x.com/a.ogg', legenda: 'x' }], interacao: { tipo: 'nenhuma' } },
      pessoa,
    );
    expect(c).toEqual({ type: 'audio', audio: { link: 'https://x.com/a.ogg' } });
  });
});

describe('id do clique', () => {
  it('ida e volta', () => {
    const fluxo = '11111111-2222-3333-4444-555555555555';
    const id = `${prefixoDeResposta(fluxo, 'men_abc')}bot_x`;
    expect(lerIdDeResposta(id)).toEqual({ fluxoId: fluxo, noId: 'men_abc', saida: 'bot_x' });
  });
  it('id que não é de fluxo devolve null', () => {
    expect(lerIdDeResposta('Parar promoções')).toBeNull();
    expect(lerIdDeResposta(null)).toBeNull();
  });
});

describe('montarPergunta', () => {
  it('sem sugestões é texto puro; com sugestões vira botões', () => {
    expect(montarPergunta({ pergunta: 'Nome?', tipoResposta: 'texto', salvarEm: 'nome' }, pessoa, 'p_')).toEqual({
      type: 'text',
      text: { body: 'Nome?' },
    });
    const c = montarPergunta({ pergunta: 'Destino?', tipoResposta: 'texto', salvarEm: null, sugestoes: ['Japão', 'Peru'] }, pessoa, 'p_');
    expect(c).toMatchObject({ interactive: { action: { buttons: [{ reply: { id: 'p__s0', title: 'Japão' } }, { reply: { title: 'Peru' } }] } } });
  });
});

describe('lerEntrada', () => {
  it('texto', () => {
    expect(lerEntrada({ type: 'text', text: { body: 'oi' } })).toMatchObject({ tipo: 'texto', texto: 'oi', idResposta: null });
  });
  it('clique em botão interativo traz o id', () => {
    expect(lerEntrada({ type: 'interactive', interactive: { button_reply: { id: 'f:x', title: 'Japão' } } })).toMatchObject({
      tipo: 'resposta_botao',
      texto: 'Japão',
      idResposta: 'f:x',
    });
  });
  it('botão de TEMPLATE traz o payload', () => {
    expect(lerEntrada({ type: 'button', button: { text: 'Quero', payload: 'f:y' } })).toMatchObject({ texto: 'Quero', idResposta: 'f:y' });
  });
  it('anúncio de clique para o WhatsApp', () => {
    expect(
      lerEntrada({ type: 'text', text: { body: 'oi' }, referral: { source_type: 'ad', source_id: '120200' } }).anuncioId,
    ).toBe('120200');
  });
});

describe('casaPalavraChave', () => {
  it('contém casa palavra inteira, sem acento nem caixa', () => {
    expect(casaPalavraChave('Quero ir pro JAPÃO!', { palavras: ['japao'], modo: 'contem' })).toBe(true);
  });
  it('"peru" não dispara com "perguntar"', () => {
    expect(casaPalavraChave('posso perguntar?', { palavras: ['peru'], modo: 'contem' })).toBe(false);
  });
  it('exata e começa com', () => {
    expect(casaPalavraChave('menu', { palavras: ['menu'], modo: 'exata' })).toBe(true);
    expect(casaPalavraChave('menu por favor', { palavras: ['menu'], modo: 'exata' })).toBe(false);
    expect(casaPalavraChave('menu por favor', { palavras: ['menu'], modo: 'comeca' })).toBe(true);
  });
  it('frase de várias palavras', () => {
    expect(casaPalavraChave('quero saber o valor da viagem', { palavras: ['valor da viagem'] })).toBe(true);
  });
});

describe('link de referência', () => {
  it('o código viaja no texto e volta', () => {
    const link = linkDeReferencia('+55 11 92633-2597', 'live-peru', 'Quero a live');
    expect(link).toBe(`https://wa.me/5511926332597?text=${encodeURIComponent('Quero a live [ref:live-peru]')}`);
    expect(codigoDeReferencia('Quero a live [ref:Live-Peru]')).toBe('live-peru');
    expect(codigoDeReferencia('sem código')).toBeNull();
  });
});

describe('validarResposta', () => {
  it('email', () => {
    expect(validarResposta('email', ' Maria@Gmail.com ')).toBe('maria@gmail.com');
    expect(validarResposta('email', 'maria@')).toBeNull();
  });
  it('telefone ganha DDI', () => {
    expect(validarResposta('telefone', '(11) 99999-0000')).toBe('5511999990000');
  });
  it('número com vírgula', () => {
    expect(validarResposta('numero', '2,5')).toBe('2.5');
    expect(validarResposta('numero', 'dois')).toBeNull();
  });
  it('data dd/mm/aaaa', () => {
    expect(validarResposta('data', '05/03/2027')).toBe('2027-03-05');
    expect(validarResposta('data', '40/03/2027')).toBeNull();
  });
});

describe('avaliarCondicao', () => {
  const ctx = { ...pessoa, tags: ['Lead-Quente'], janelaAberta: true, inscritoWhatsapp: true };
  it('tag sem diferenciar caixa', () => {
    expect(avaliarCondicao({ combinar: 'todas', regras: [{ campo: 'tag', operador: 'tem', valor: 'lead-quente' }] }, ctx)).toBe(true);
    expect(avaliarCondicao({ combinar: 'todas', regras: [{ campo: 'tag', operador: 'nao_tem', valor: 'lead-quente' }] }, ctx)).toBe(false);
  });
  it('campo personalizado e combinação qualquer', () => {
    expect(
      avaliarCondicao(
        {
          combinar: 'qualquer',
          regras: [
            { campo: 'campo', chave: 'destino', operador: 'igual', valor: 'peru' },
            { campo: 'campo', chave: 'destino', operador: 'igual', valor: 'japao' },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });
  it('janela aberta', () => {
    expect(avaliarCondicao({ combinar: 'todas', regras: [{ campo: 'janela_aberta', operador: 'tem' }] }, { ...ctx, janelaAberta: false })).toBe(false);
  });
});

describe('escolherVariante', () => {
  const v = [
    { id: 'a', nome: 'A', peso: 70 },
    { id: 'b', nome: 'B', peso: 30 },
  ];
  it('respeita os pesos', () => {
    expect(escolherVariante(v, 0.1)?.id).toBe('a');
    expect(escolherVariante(v, 0.69)?.id).toBe('a');
    expect(escolherVariante(v, 0.71)?.id).toBe('b');
  });
});

describe('calcularAcordar', () => {
  const agora = new Date('2026-09-23T15:00:00-03:00');
  it('sem faixa: soma simples', () => {
    expect(calcularAcordar({ quantidade: 2, unidade: 'horas' }, agora).toISOString()).toBe(new Date('2026-09-23T17:00:00-03:00').toISOString());
  });
  it('cai fora da faixa → empurra para a próxima abertura', () => {
    const r = calcularAcordar({ quantidade: 7, unidade: 'horas', janelaInicio: '09:00', janelaFim: '20:00' }, agora);
    expect(r.toISOString()).toBe(new Date('2026-09-24T09:00:00-03:00').toISOString());
  });
  it('dentro da faixa: mantém', () => {
    const r = calcularAcordar({ quantidade: 1, unidade: 'dias', janelaInicio: '09:00', janelaFim: '20:00' }, agora);
    expect(r.toISOString()).toBe(new Date('2026-09-24T15:00:00-03:00').toISOString());
  });
});

describe('janelaAberta', () => {
  it('conta 24 h da última mensagem da pessoa', () => {
    const agora = Date.now();
    expect(janelaAberta(new Date(agora - 3_600_000).toISOString(), agora)).toBe(true);
    expect(janelaAberta(new Date(agora - 25 * 3_600_000).toISOString(), agora)).toBe(false);
    expect(janelaAberta(null, agora)).toBe(false);
  });
});

describe('saidasDoNo e validarGrafo', () => {
  it('mensagem com botões: uma saída por botão + texto livre + janela fechada', () => {
    const n = noPadrao('mensagem', 0, 0) as No & { tipo: 'mensagem' };
    n.dados.interacao = { tipo: 'botoes', botoes: [{ id: 'b1', titulo: 'A' }, { id: 'b2', titulo: 'B' }] };
    expect(saidasDoNo(n).map((s) => s.id)).toEqual(['b1', 'b2', 'texto_livre', 'janela_fechada']);
  });

  it('grafo inicial só reclama da mensagem vazia', () => {
    const graves = validarGrafo(grafoInicial()).filter((p) => p.grave);
    expect(graves).toHaveLength(1);
    expect(graves[0].mensagem).toMatch(/vazio/);
  });

  it('botão longo demais e botões repetidos são graves', () => {
    const g: Grafo = grafoInicial();
    const m = g.nos[1] as No & { tipo: 'mensagem' };
    m.dados.blocos = [{ tipo: 'texto', texto: 'Oi' }];
    m.dados.interacao = { tipo: 'botoes', botoes: [{ id: 'a', titulo: 'x'.repeat(21) }, { id: 'b', titulo: 'x'.repeat(21) }] };
    const msgs = validarGrafo(g).filter((p) => p.grave).map((p) => p.mensagem);
    expect(msgs.some((t) => /passa de 20/.test(t))).toBe(true);
    expect(msgs.some((t) => /mesmo texto/.test(t))).toBe(true);
  });

  it('bloco solto vira aviso (não impede ativar)', () => {
    const g = grafoInicial();
    (g.nos[1] as No & { tipo: 'mensagem' }).dados.blocos = [{ tipo: 'texto', texto: 'Oi' }];
    g.nos.push(noPadrao('fim', 0, 0));
    const p = validarGrafo(g);
    expect(p.some((x) => !x.grave && /solto/.test(x.mensagem))).toBe(true);
    expect(p.filter((x) => x.grave)).toHaveLength(0);
  });

  it('todo modelo nasce com o Início ligado e sem seta quebrada', () => {
    for (const m of MODELOS) {
      const g = m.grafo();
      const problemas = validarGrafo(g);
      expect(problemas.some((p) => /Início/.test(p.mensagem)), m.id).toBe(false);
      expect(problemas.some((p) => /não existe mais/.test(p.mensagem)), m.id).toBe(false);
      expect(problemas.some((p) => /solto/.test(p.mensagem)), m.id).toBe(false);
    }
  });
});

describe('template com botões de resposta rápida', () => {
  it('o payload vai no componente button, pelo índice do template', () => {
    const c = montarComponentes({
      para: '5511',
      template: 't',
      idioma: 'pt_BR',
      botoesPayload: [{ indice: 1, payload: 'f:x:n:botao_0' }],
    });
    expect(c).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'f:x:n:botao_0' }] },
    ]);
  });
});
