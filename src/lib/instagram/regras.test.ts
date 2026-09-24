import { describe, expect, it } from 'vitest';
import {
  casaPalavra,
  escolherParaComentario,
  escolherParaDm,
  janelaAberta,
  montarMensagem,
  normalizar,
  personalizar,
  validarAutomacao,
  type AutomacaoIg,
} from './regras';

const auto = (p: Partial<AutomacaoIg> & Pick<AutomacaoIg, 'gatilho'>): AutomacaoIg => ({
  id: p.id ?? Math.random().toString(36),
  nome: p.nome ?? 'x',
  ativo: p.ativo ?? true,
  gatilho: p.gatilho,
  config: p.config ?? {},
  criado_em: p.criado_em ?? '2026-09-24T00:00:00Z',
});

describe('normalizar e casaPalavra', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizar('JAPÃO!!! 🇯🇵')).toBe('japao');
  });
  it('casa palavra inteira, não pedaço', () => {
    expect(casaPalavra('Quero o ROTEIRO!', 'roteiro')).toBe(true);
    expect(casaPalavra('neutro', 'eu')).toBe(false);
    expect(casaPalavra('Europa', 'eu')).toBe(false);
    expect(casaPalavra('eu quero muito', 'eu quero')).toBe(true);
  });
});

describe('escolherParaComentario', () => {
  const geral = auto({ id: 'geral', gatilho: 'comentario', config: { qualquer_palavra: true, dm_texto: 'oi' } });
  const palavra = auto({ id: 'palavra', gatilho: 'comentario', config: { palavras: ['japão'], dm_texto: 'oi' } });
  const doPost = auto({ id: 'post', gatilho: 'comentario', config: { palavras: ['japão'], posts: ['111'], dm_texto: 'oi' } });

  it('a mais específica ganha', () => {
    expect(escolherParaComentario([geral, palavra, doPost], 'quero o japao', '111')?.id).toBe('post');
    expect(escolherParaComentario([geral, palavra, doPost], 'quero o japao', '222')?.id).toBe('palavra');
    expect(escolherParaComentario([geral, palavra, doPost], 'lindo!', '222')?.id).toBe('geral');
  });
  it('ignora inativa e de outro gatilho', () => {
    expect(escolherParaComentario([auto({ gatilho: 'comentario', ativo: false, config: { qualquer_palavra: true } })], 'x', null)).toBeNull();
    expect(escolherParaComentario([auto({ gatilho: 'dm_palavra', config: { qualquer_palavra: true } })], 'x', null)).toBeNull();
  });
});

describe('escolherParaDm', () => {
  const boas = auto({ id: 'boas', gatilho: 'boas_vindas', config: { dm_texto: 'bem-vindo' } });
  const palavra = auto({ id: 'palavra', gatilho: 'dm_palavra', config: { palavras: ['peru'], dm_texto: 'peru' } });
  const mencao = auto({ id: 'mencao', gatilho: 'story_mencao', config: { dm_texto: 'valeu' } });
  const story = auto({ id: 'story', gatilho: 'story_resposta', config: { dm_texto: 'oi' } });
  const base = { texto: '', ehRespostaStory: false, ehMencaoStory: false, primeiraMensagem: false };

  it('menção de story vai para a automação de menção', () => {
    expect(escolherParaDm([boas, palavra, mencao], { ...base, ehMencaoStory: true })?.id).toBe('mencao');
  });
  it('resposta a story sem palavras responde qualquer texto', () => {
    expect(escolherParaDm([story], { ...base, texto: 'amei', ehRespostaStory: true })?.id).toBe('story');
  });
  it('palavra-chave antes de boas-vindas; boas-vindas só na primeira mensagem', () => {
    expect(escolherParaDm([boas, palavra], { ...base, texto: 'Peru', primeiraMensagem: true })?.id).toBe('palavra');
    expect(escolherParaDm([boas, palavra], { ...base, texto: 'oi', primeiraMensagem: true })?.id).toBe('boas');
    expect(escolherParaDm([boas, palavra], { ...base, texto: 'oi' })).toBeNull();
  });
});

describe('montarMensagem', () => {
  it('sem botão é texto puro', () => {
    expect(montarMensagem('oi')).toEqual({ text: 'oi' });
  });
  it('com botão vira template de botão e corta o título em 20', () => {
    const m = montarMensagem('veja', [{ titulo: 'Ver o roteiro completo agora', url: 'https://x.com' }, { titulo: 'ruim', url: 'javascript:alert(1)' }]) as {
      attachment: { payload: { buttons: { title: string; url: string }[] } };
    };
    expect(m.attachment.payload.buttons).toEqual([{ type: 'web_url', url: 'https://x.com', title: 'Ver o roteiro comple' }]);
  });
});

describe('personalizar', () => {
  it('usa o primeiro nome, ou o @ quando não há nome', () => {
    expect(personalizar('Oi {{nome}}, tudo bem?', { nome: 'Ana Souza' })).toBe('Oi Ana, tudo bem?');
    expect(personalizar('Oi {{nome}}!', { username: 'ana.viaja' })).toBe('Oi ana.viaja!');
    expect(personalizar('Oi {{ nome }}!', {})).toBe('Oi!');
  });
});

describe('janelaAberta', () => {
  it('24 horas desde a última mensagem da pessoa', () => {
    const agora = new Date('2026-09-24T12:00:00Z');
    expect(janelaAberta('2026-09-23T13:00:00Z', agora)).toBe(true);
    expect(janelaAberta('2026-09-23T11:00:00Z', agora)).toBe(false);
    expect(janelaAberta(null, agora)).toBe(false);
  });
});

describe('validarAutomacao', () => {
  it('comentário exige palavra ou "qualquer texto"', () => {
    expect(validarAutomacao({ nome: 'a', gatilho: 'comentario', config: { dm_texto: 'oi' } }).ok).toBe(false);
    expect(validarAutomacao({ nome: 'a', gatilho: 'comentario', config: { dm_texto: 'oi', palavras: 'japão, peru' } }).ok).toBe(true);
  });
  it('recusa botão sem https e título longo', () => {
    expect(validarAutomacao({ nome: 'a', gatilho: 'boas_vindas', config: { dm_texto: 'oi', dm_botoes: [{ titulo: 'x', url: 'x.com' }] } }).ok).toBe(false);
    expect(
      validarAutomacao({ nome: 'a', gatilho: 'boas_vindas', config: { dm_texto: 'oi', dm_botoes: [{ titulo: 'um título bem comprido demais', url: 'https://x.com' }] } }).ok,
    ).toBe(false);
  });
  it('posts só valem para comentário e só dígitos', () => {
    const r = validarAutomacao({ nome: 'a', gatilho: 'comentario', config: { qualquer_palavra: true, dm_texto: 'oi', posts: ['123', 'abc'] } });
    expect(r.ok && r.valor.config.posts).toEqual(['123']);
    const r2 = validarAutomacao({ nome: 'a', gatilho: 'dm_palavra', config: { palavras: 'x', dm_texto: 'oi', posts: ['123'] } });
    expect(r2.ok && r2.valor.config.posts).toEqual([]);
  });
});
