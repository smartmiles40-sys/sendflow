// Modelos prontos — a "biblioteca de templates" do ManyChat, com a cara da agência.
//
// Cada modelo é um fluxo completo, já ligado, para a equipe abrir, trocar o texto e
// ativar. Os gatilhos nascem DESLIGADOS: ninguém quer um "Oi, tudo bem?" genérico
// respondendo cliente de verdade antes de alguém revisar a frase.

import type { Acao, BotaoResposta, Grafo, GatilhoConfig, Ligacao, No, TipoGatilho } from './tipos';
import { novoId, noPadrao } from './tipos';

export interface Modelo {
  id: string;
  nome: string;
  descricao: string;
  icone: string;
  gatilho?: { tipo: TipoGatilho; config: GatilhoConfig };
  grafo: () => Grafo;
}

// ── Pequeno construtor de grafo ──────────────────────────────────────────────────

class Montador {
  nos: No[] = [];
  ligacoes: Ligacao[] = [];

  add<N extends No>(no: N, titulo?: string): N {
    if (titulo) no.titulo = titulo;
    this.nos.push(no);
    return no;
  }
  ligar(de: No, saida: string, para: No) {
    this.ligacoes.push({ id: novoId('l'), de: de.id, saida, para: para.id });
  }
  grafo(): Grafo {
    return { nos: this.nos, ligacoes: this.ligacoes };
  }
}

function msg(x: number, y: number, textos: string[], botoes?: string[]): No & { tipo: 'mensagem' } {
  const n = noPadrao('mensagem', x, y) as No & { tipo: 'mensagem' };
  n.dados.blocos = textos.map((texto) => ({ tipo: 'texto' as const, texto }));
  if (botoes?.length) {
    const lista: BotaoResposta[] = botoes.map((titulo) => ({ id: novoId('b'), titulo }));
    n.dados.interacao = { tipo: 'botoes', botoes: lista };
  }
  return n;
}

function acoes(x: number, y: number, lista: Acao[]): No & { tipo: 'acao' } {
  const n = noPadrao('acao', x, y) as No & { tipo: 'acao' };
  n.dados.acoes = lista;
  return n;
}

function pergunta(
  x: number,
  y: number,
  texto: string,
  tipoResposta: 'texto' | 'email' | 'telefone' | 'numero' | 'data',
  salvarEm: string,
  sugestoes: string[] = [],
): No & { tipo: 'pergunta' } {
  const n = noPadrao('pergunta', x, y) as No & { tipo: 'pergunta' };
  n.dados.pergunta = texto;
  n.dados.tipoResposta = tipoResposta;
  n.dados.salvarEm = salvarEm;
  n.dados.sugestoes = sugestoes;
  return n;
}

function botaoId(n: No & { tipo: 'mensagem' }, i: number): string {
  return n.dados.interacao.tipo === 'botoes' ? n.dados.interacao.botoes[i].id : 'proximo';
}

// ── Os modelos ───────────────────────────────────────────────────────────────────

export const MODELOS: Modelo[] = [
  {
    id: 'boas-vindas-menu',
    nome: 'Boas-vindas com menu',
    icone: '👋',
    descricao: 'Primeira mensagem de quem chega: apresenta a agência e oferece 3 caminhos em botões.',
    gatilho: { tipo: 'boas_vindas', config: {} },
    grafo: () => {
      const m = new Montador();
      const ini = m.add(noPadrao('inicio', 40, 220));
      const menu = m.add(
        msg(340, 160, [
          'Oi, {{primeiro_nome}}! 👋 Aqui é da *Se Tu For, Eu Vou! Viagens*.',
          'Como posso te ajudar hoje?',
        ], ['Ver expedições', 'Falar com consultor', 'Próximas lives']),
        'Menu principal',
      );
      m.ligar(ini, 'proximo', menu);

      const exped = m.add(
        msg(720, 20, ['Nossas expedições em grupo de 2027 🌍', 'Qual destino te chama mais?'], ['Japão', 'Peru', 'Islândia']),
        'Destinos',
      );
      m.ligar(menu, botaoId(menu, 0), exped);
      const tagDestino = m.add(
        acoes(1100, 20, [{ tipo: 'definir_campo', chave: 'destino_interesse', valor: 'expedição' }, { tipo: 'adicionar_tag', tag: 'interesse-expedicao' }]),
        'Marca interesse',
      );
      for (let i = 0; i < 3; i += 1) m.ligar(exped, botaoId(exped, i), tagDestino);
      const consultor1 = m.add(msg(1440, 20, ['Perfeito! Um consultor vai te chamar por aqui com roteiro e valores. ✈️']), 'Confirma');
      m.ligar(tagDestino, 'proximo', consultor1);

      const humano = m.add(
        acoes(720, 300, [
          { tipo: 'adicionar_tag', tag: 'quer-consultor' },
          { tipo: 'pausar_automacao', horas: 24 },
          { tipo: 'notificar_equipe', email: '', mensagem: '{{nome}} pediu para falar com um consultor.' },
        ]),
        'Passa para humano',
      );
      m.ligar(menu, botaoId(menu, 1), humano);
      const aviso = m.add(msg(1100, 300, ['Já chamei alguém do time! Em instantes um consultor te responde por aqui. 🙌']), 'Aviso');
      m.ligar(humano, 'proximo', aviso);

      const lives = m.add(
        msg(720, 520, ['Toda semana tem live gratuita sobre um destino 🎥', 'Quer receber o link das próximas?'], ['Quero!', 'Agora não']),
        'Lives',
      );
      m.ligar(menu, botaoId(menu, 2), lives);
      const tagLive = m.add(acoes(1100, 480, [{ tipo: 'adicionar_tag', tag: 'lives' }]), 'Inscreve nas lives');
      m.ligar(lives, botaoId(lives, 0), tagLive);
      const okLive = m.add(msg(1440, 480, ['Combinado! Você vai receber o aviso aqui antes de cada live. 💚']), 'Confirma live');
      m.ligar(tagLive, 'proximo', okLive);
      return m.grafo();
    },
  },
  {
    id: 'captura-lead',
    nome: 'Captura de lead (nome, e-mail, destino)',
    icone: '🧲',
    descricao: 'Faz 3 perguntas, salva nos campos do contato, marca a tag e avisa o time comercial.',
    gatilho: { tipo: 'palavra_chave', config: { palavras: ['orçamento', 'orcamento', 'valores', 'preço'], modo: 'contem' } },
    grafo: () => {
      const m = new Montador();
      const ini = m.add(noPadrao('inicio', 40, 200));
      const abre = m.add(msg(320, 180, ['Legal! Vou te fazer 3 perguntinhas rápidas pra montar sua proposta. 📝']), 'Abertura');
      m.ligar(ini, 'proximo', abre);
      const pNome = m.add(pergunta(640, 160, 'Qual é o seu nome completo?', 'texto', 'nome'), 'Nome');
      m.ligar(abre, 'proximo', pNome);
      const pEmail = m.add(pergunta(960, 160, 'E o seu melhor e-mail?', 'email', 'email'), 'E-mail');
      pEmail.dados.mensagemErro = 'Hmm, esse e-mail não parece certo. Pode mandar de novo? (ex.: nome@gmail.com)';
      m.ligar(pNome, 'respondeu', pEmail);
      const pDestino = m.add(
        pergunta(1280, 160, 'Para qual destino você está pensando em viajar?', 'texto', 'destino_interesse', ['Japão', 'Peru', 'Outro']),
        'Destino',
      );
      m.ligar(pEmail, 'respondeu', pDestino);
      const fecha = m.add(
        acoes(1600, 160, [
          { tipo: 'adicionar_tag', tag: 'lead-whatsapp' },
          { tipo: 'notificar_equipe', email: '', mensagem: 'Lead novo: {{nome}} · {{email}} · destino {{destino_interesse}}' },
        ]),
        'Salva e avisa',
      );
      m.ligar(pDestino, 'respondeu', fecha);
      m.ligar(pDestino, 'nao_respondeu', fecha);
      const obrigado = m.add(msg(1920, 160, ['Obrigado, {{primeiro_nome}}! Nosso time vai te mandar a proposta de {{destino_interesse}} em breve. ✈️']), 'Obrigado');
      m.ligar(fecha, 'proximo', obrigado);
      return m.grafo();
    },
  },
  {
    id: 'palavra-destino',
    nome: 'Palavra-chave de destino',
    icone: '🗾',
    descricao: 'Quem escreve "japão" recebe a apresentação da expedição com botões de próximo passo.',
    gatilho: { tipo: 'palavra_chave', config: { palavras: ['japão', 'japao', 'japan'], modo: 'contem' } },
    grafo: () => {
      const m = new Montador();
      const ini = m.add(noPadrao('inicio', 40, 200));
      const apresenta = m.add(
        msg(320, 160, [
          '🇯🇵 *Expedição Japão 2027* — 15 dias com grupo pequeno, guia brasileiro e roteiro que vai de Tóquio a Kyoto.',
          'O que você quer fazer agora?',
        ], ['Ver roteiro', 'Saber valores', 'Falar com alguém']),
        'Apresentação',
      );
      m.ligar(ini, 'proximo', apresenta);
      const roteiro = m.add(msg(700, 20, ['Aqui está o roteiro completo:']), 'Roteiro');
      roteiro.dados.interacao = { tipo: 'link', rotulo: 'Abrir roteiro', url: 'https://setuforeuvouviagens.com.br' };
      m.ligar(apresenta, botaoId(apresenta, 0), roteiro);
      const valores = m.add(pergunta(700, 200, 'Te mando os valores por e-mail. Qual é o seu?', 'email', 'email'), 'Pede e-mail');
      m.ligar(apresenta, botaoId(apresenta, 1), valores);
      const tag = m.add(acoes(1040, 200, [{ tipo: 'adicionar_tag', tag: 'japao-valores' }]), 'Tag');
      m.ligar(valores, 'respondeu', tag);
      const ok = m.add(msg(1360, 200, ['Enviado! Confira sua caixa de entrada (e o spam 😉).']), 'Confirma');
      m.ligar(tag, 'proximo', ok);
      const humano = m.add(acoes(700, 400, [{ tipo: 'pausar_automacao', horas: 24 }, { tipo: 'adicionar_tag', tag: 'quer-consultor' }]), 'Humano');
      m.ligar(apresenta, botaoId(apresenta, 2), humano);
      const aviso = m.add(msg(1040, 400, ['Um consultor já vai falar com você por aqui!']), 'Aviso');
      m.ligar(humano, 'proximo', aviso);
      return m.grafo();
    },
  },
  {
    id: 'resposta-padrao',
    nome: 'Resposta padrão',
    icone: '🤖',
    descricao: 'Quando nada mais casou: explica o que o robô entende e oferece o menu (no máximo 1x a cada 24 h).',
    gatilho: { tipo: 'padrao', config: { intervalo_horas: 24 } },
    grafo: () => {
      const m = new Montador();
      const ini = m.add(noPadrao('inicio', 40, 200));
      const r = m.add(
        msg(340, 160, ['Recebi sua mensagem! 😊', 'Se preferir, escolha uma opção abaixo que eu já te ajudo:'], ['Expedições', 'Falar com consultor']),
        'Não entendi',
      );
      m.ligar(ini, 'proximo', r);
      const humano = m.add(acoes(720, 240, [{ tipo: 'pausar_automacao', horas: 12 }]), 'Humano');
      m.ligar(r, botaoId(r, 1), humano);
      const aviso = m.add(msg(1040, 240, ['Beleza, já chamo alguém do time!']), 'Aviso');
      m.ligar(humano, 'proximo', aviso);
      const exped = m.add(msg(720, 40, ['Escreva o nome do destino (ex.: *Japão*, *Peru*) que eu te mando tudo sobre ele.']), 'Dica');
      m.ligar(r, botaoId(r, 0), exped);
      return m.grafo();
    },
  },
  {
    id: 'sequencia-lead-lp',
    nome: 'Sequência para lead da LP',
    icone: '📅',
    descricao: 'Para o webhook da landing page: template de boas-vindas, espera 2 dias e manda o follow-up se não respondeu.',
    gatilho: { tipo: 'webhook', config: {} },
    grafo: () => {
      const m = new Montador();
      const ini = m.add(noPadrao('inicio', 40, 200));
      const t1 = m.add(noPadrao('template', 320, 160), 'Template de boas-vindas');
      m.ligar(ini, 'proximo', t1);
      const espera = m.add(noPadrao('aguardar', 640, 160), 'Espera 2 dias');
      if (espera.tipo === 'aguardar') {
        espera.dados.quantidade = 2;
        espera.dados.unidade = 'dias';
        espera.dados.janelaInicio = '09:00';
        espera.dados.janelaFim = '20:00';
      }
      m.ligar(t1, 'proximo', espera);
      const cond = m.add(noPadrao('condicao', 960, 160), 'Já conversou?');
      if (cond.tipo === 'condicao') cond.dados.regras = [{ campo: 'janela_aberta', operador: 'tem' }];
      m.ligar(espera, 'proximo', cond);
      const t2 = m.add(noPadrao('template', 1280, 260), 'Template de follow-up');
      m.ligar(cond, 'nao', t2);
      const fim = m.add(noPadrao('fim', 1280, 60), 'Já está em conversa');
      m.ligar(cond, 'sim', fim);
      return m.grafo();
    },
  },
  {
    id: 'anuncio-ctwa',
    nome: 'Anúncio de clique para o WhatsApp',
    icone: '📣',
    descricao: 'Quem chega pelo anúncio do Instagram/Facebook recebe uma qualificação rápida em lista.',
    gatilho: { tipo: 'anuncio', config: { ad_ids: [] } },
    grafo: () => {
      const m = new Montador();
      const ini = m.add(noPadrao('inicio', 40, 200));
      const lista = m.add(msg(340, 160, ['Oi! Que bom que você veio pelo nosso anúncio 💚', 'Quando você pensa em viajar?']), 'Quando?');
      lista.dados.interacao = {
        tipo: 'lista',
        rotuloBotao: 'Escolher',
        secoes: [
          {
            titulo: '',
            itens: [
              { id: novoId('i'), titulo: 'Nos próximos 3 meses' },
              { id: novoId('i'), titulo: 'Ainda este ano' },
              { id: novoId('i'), titulo: 'Em 2027' },
              { id: novoId('i'), titulo: 'Só pesquisando' },
            ],
          },
        ],
      };
      m.ligar(ini, 'proximo', lista);
      const quente = m.add(acoes(720, 80, [{ tipo: 'adicionar_tag', tag: 'lead-quente' }, { tipo: 'pausar_automacao', horas: 24 }]), 'Quente');
      const frio = m.add(acoes(720, 320, [{ tipo: 'adicionar_tag', tag: 'lead-nutricao' }]), 'Nutrição');
      if (lista.dados.interacao.tipo === 'lista') {
        const itens = lista.dados.interacao.secoes[0].itens;
        m.ligar(lista, itens[0].id, quente);
        m.ligar(lista, itens[1].id, quente);
        m.ligar(lista, itens[2].id, frio);
        m.ligar(lista, itens[3].id, frio);
      }
      const q = m.add(msg(1040, 80, ['Perfeito! Um consultor vai te chamar agora mesmo. ✈️']), 'Consultor');
      m.ligar(quente, 'proximo', q);
      const f = m.add(msg(1040, 320, ['Ótimo! Vou te mandar novidades e as lives dos destinos por aqui. 💚']), 'Nutrição');
      m.ligar(frio, 'proximo', f);
      return m.grafo();
    },
  },
];
