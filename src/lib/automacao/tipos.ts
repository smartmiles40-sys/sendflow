// O vocabulário das automações — o "ManyChat" do SendFlow.
//
// Um FLUXO é um grafo: nós (blocos) ligados por setas. Cada seta sai de uma SAÍDA
// nomeada do nó ("proximo", o id de um botão, "sim"/"nao"…) e entra em outro nó. O
// grafo inteiro mora em `fluxos.grafo` (jsonb) — é o que o editor desenha e o que o
// motor percorre. Este arquivo é o contrato entre os dois: se um tipo de nó não está
// aqui, nem a tela sabe desenhar nem o motor sabe executar.
//
// Tudo aqui é puro (sem I/O), para o editor no navegador e o motor no servidor
// compartilharem as mesmas regras — inclusive a validação que roda antes de ativar.

// ── Nós ──────────────────────────────────────────────────────────────────────────

export type TipoNo =
  | 'inicio'
  | 'mensagem'
  | 'template'
  | 'pergunta'
  | 'aguardar'
  | 'condicao'
  | 'acao'
  | 'randomizador'
  | 'ir_para'
  | 'fim';

/** Um pedaço de conteúdo dentro de um nó de mensagem. Vários saem em sequência. */
export type Bloco =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'imagem' | 'video' | 'audio' | 'documento'; url: string; legenda?: string; nome?: string };

export interface BotaoResposta {
  /** Id estável: é a SAÍDA do nó e o `id` que a Meta devolve quando a pessoa clica. */
  id: string;
  /** Até 20 caracteres — limite da Meta para botão de resposta. */
  titulo: string;
}

export interface ItemLista {
  id: string;
  /** Até 24 caracteres. */
  titulo: string;
  /** Até 72 caracteres. */
  descricao?: string;
}

export interface SecaoLista {
  titulo: string;
  itens: ItemLista[];
}

/**
 * O que acompanha a ÚLTIMA mensagem do nó. Só um de cada vez — a Meta não mistura
 * botões e lista na mesma mensagem.
 */
export type Interacao =
  | { tipo: 'nenhuma' }
  | { tipo: 'botoes'; botoes: BotaoResposta[] }
  | { tipo: 'lista'; rotuloBotao: string; secoes: SecaoLista[] }
  | { tipo: 'link'; rotulo: string; url: string };

export interface DadosMensagem {
  blocos: Bloco[];
  interacao: Interacao;
  /** Cabeçalho curto (texto) acima da mensagem interativa. Opcional. */
  cabecalho?: string;
  /** Rodapé cinza da mensagem interativa. Opcional. */
  rodape?: string;
  /**
   * Quanto tempo esperar o clique antes de seguir pela saída "sem_resposta".
   * 0 = espera para sempre (até a pessoa clicar ou mandar outra coisa).
   */
  esperarMinutos?: number;
  /** Mostrar "digitando…" e esperar um pouco entre os blocos, como uma pessoa. */
  digitando?: boolean;
}

export interface DadosTemplate {
  nome: string;
  idioma: string;
  /** Mapa posição → texto com marcadores: {"1": "{{primeiro_nome}}"}. */
  variaveis: Record<string, string>;
  cabecalhoUrl?: string | null;
  /** Textos dos botões de resposta rápida do template — cada um vira uma saída. */
  botoes?: string[];
}

export type TipoResposta = 'texto' | 'numero' | 'email' | 'telefone' | 'data' | 'qualquer';

export interface DadosPergunta {
  pergunta: string;
  tipoResposta: TipoResposta;
  /** Onde guardar: 'nome', 'email', 'telefone' ou a chave de um campo personalizado. */
  salvarEm: string | null;
  /** Sugestões em botão (até 3). A pessoa pode clicar ou digitar. */
  sugestoes?: string[];
  mensagemErro?: string;
  /** Tentativas antes de desistir e seguir por "nao_respondeu". */
  tentativas?: number;
  /** Prazo para responder. 0 = sem prazo. */
  esperarMinutos?: number;
}

export type UnidadeTempo = 'minutos' | 'horas' | 'dias';

export interface DadosAguardar {
  quantidade: number;
  unidade: UnidadeTempo;
  /** Só seguir dentro desta faixa de horário (São Paulo). Ex.: "09:00"–"20:00". */
  janelaInicio?: string | null;
  janelaFim?: string | null;
}

export type CampoCondicao =
  | 'tag'
  | 'campo'
  | 'nome'
  | 'email'
  | 'telefone'
  | 'janela_aberta'
  | 'inscrito_whatsapp';

export type OperadorCondicao =
  | 'tem'
  | 'nao_tem'
  | 'igual'
  | 'diferente'
  | 'contem'
  | 'nao_contem'
  | 'vazio'
  | 'preenchido'
  | 'maior'
  | 'menor';

export interface Regra {
  campo: CampoCondicao;
  /** Chave do campo personalizado quando `campo === 'campo'`. */
  chave?: string;
  operador: OperadorCondicao;
  valor?: string;
}

export interface DadosCondicao {
  combinar: 'todas' | 'qualquer';
  regras: Regra[];
}

export type Acao =
  | { tipo: 'adicionar_tag'; tag: string }
  | { tipo: 'remover_tag'; tag: string }
  | { tipo: 'definir_campo'; chave: string; valor: string }
  | { tipo: 'limpar_campo'; chave: string }
  | { tipo: 'adicionar_lista'; listaId: string }
  | { tipo: 'remover_lista'; listaId: string }
  | { tipo: 'descadastrar' }
  | { tipo: 'reinscrever' }
  | { tipo: 'pausar_automacao'; horas: number }
  | { tipo: 'notificar_equipe'; email: string; mensagem: string }
  | { tipo: 'webhook'; url: string }
  | { tipo: 'parar_outros_fluxos' };

export interface DadosAcao {
  acoes: Acao[];
}

export interface Variante {
  id: string;
  nome: string;
  /** Peso relativo (%). A soma não precisa dar 100 — o motor normaliza. */
  peso: number;
}

export interface DadosRandomizador {
  variantes: Variante[];
}

export interface DadosIrPara {
  fluxoId: string | null;
}

export type DadosInicio = Record<string, never>;
export type DadosFim = Record<string, never>;

interface NoBase<T extends TipoNo, D> {
  id: string;
  tipo: T;
  x: number;
  y: number;
  /** Nome que aparece no topo do cartão no editor. */
  titulo?: string;
  dados: D;
}

export type No =
  | NoBase<'inicio', DadosInicio>
  | NoBase<'mensagem', DadosMensagem>
  | NoBase<'template', DadosTemplate>
  | NoBase<'pergunta', DadosPergunta>
  | NoBase<'aguardar', DadosAguardar>
  | NoBase<'condicao', DadosCondicao>
  | NoBase<'acao', DadosAcao>
  | NoBase<'randomizador', DadosRandomizador>
  | NoBase<'ir_para', DadosIrPara>
  | NoBase<'fim', DadosFim>;

export interface Ligacao {
  id: string;
  de: string;
  /** Nome da saída do nó de origem. */
  saida: string;
  para: string;
}

export interface Grafo {
  nos: No[];
  ligacoes: Ligacao[];
}

// ── Saídas de cada nó ────────────────────────────────────────────────────────────

export interface Saida {
  id: string;
  rotulo: string;
  /** Saída secundária (erro, prazo, janela fechada): desenhada menor e em outra cor. */
  secundaria?: boolean;
}

/**
 * As saídas que um nó oferece. É a MESMA função no editor (para desenhar as bolinhas
 * de onde saem as setas) e no motor (para decidir o próximo passo) — se divergissem,
 * uma seta desenhada poderia nunca ser seguida.
 */
export function saidasDoNo(no: No): Saida[] {
  switch (no.tipo) {
    case 'inicio':
      return [{ id: 'proximo', rotulo: 'Começar' }];
    case 'mensagem': {
      const d = no.dados;
      const extras: Saida[] = [];
      if ((d.esperarMinutos ?? 0) > 0 && d.interacao.tipo !== 'nenhuma' && d.interacao.tipo !== 'link') {
        extras.push({ id: 'sem_resposta', rotulo: 'Não respondeu', secundaria: true });
      }
      extras.push({ id: 'janela_fechada', rotulo: 'Janela de 24 h fechada', secundaria: true });
      if (d.interacao.tipo === 'botoes') {
        return [
          ...d.interacao.botoes.map((b) => ({ id: b.id, rotulo: b.titulo || 'Botão' })),
          { id: 'texto_livre', rotulo: 'Digitou outra coisa', secundaria: true },
          ...extras,
        ];
      }
      if (d.interacao.tipo === 'lista') {
        return [
          ...d.interacao.secoes.flatMap((s) => s.itens.map((i) => ({ id: i.id, rotulo: i.titulo || 'Opção' }))),
          { id: 'texto_livre', rotulo: 'Digitou outra coisa', secundaria: true },
          ...extras,
        ];
      }
      return [{ id: 'proximo', rotulo: 'Depois de enviar' }, ...extras];
    }
    case 'template': {
      const botoes = no.dados.botoes ?? [];
      return [
        { id: 'proximo', rotulo: 'Depois de enviar' },
        ...botoes.map((b, i) => ({ id: `botao_${i}`, rotulo: b })),
        { id: 'falha', rotulo: 'Não enviou', secundaria: true },
      ];
    }
    case 'pergunta':
      return [
        { id: 'respondeu', rotulo: 'Respondeu' },
        { id: 'nao_respondeu', rotulo: 'Não respondeu / inválido', secundaria: true },
        { id: 'janela_fechada', rotulo: 'Janela de 24 h fechada', secundaria: true },
      ];
    case 'aguardar':
      return [{ id: 'proximo', rotulo: 'Depois de esperar' }];
    case 'condicao':
      return [
        { id: 'sim', rotulo: 'Sim' },
        { id: 'nao', rotulo: 'Não' },
      ];
    case 'acao':
      return [{ id: 'proximo', rotulo: 'Depois' }];
    case 'randomizador':
      return no.dados.variantes.map((v) => ({ id: v.id, rotulo: `${v.nome} · ${v.peso}%` }));
    case 'ir_para':
    case 'fim':
      return [];
  }
}

// ── Limites da Meta (conferidos antes de salvar, não na hora de enviar) ──────────

export const LIMITES = {
  botoes: 3,
  tituloBotao: 20,
  itensLista: 10,
  tituloItem: 24,
  descricaoItem: 72,
  rotuloBotaoLista: 20,
  textoInterativo: 1024,
  texto: 4096,
  cabecalho: 60,
  rodape: 60,
  legenda: 1024,
} as const;

export interface ProblemaGrafo {
  noId: string | null;
  mensagem: string;
  /** Aviso não impede ativar; erro impede. */
  grave: boolean;
}

function textoDoNo(no: No): string {
  return no.titulo || ROTULO_TIPO[no.tipo];
}

/**
 * Confere o grafo antes de ativar. Pega os erros que a Meta só apontaria na hora do
 * envio — com o cliente do outro lado esperando — e os que travariam o fluxo em
 * silêncio (nó sem saída ligada, laço sem espera).
 */
export function validarGrafo(g: Grafo): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const ids = new Set(g.nos.map((n) => n.id));
  const inicio = g.nos.filter((n) => n.tipo === 'inicio');

  if (inicio.length !== 1) {
    problemas.push({ noId: null, mensagem: 'O fluxo precisa de exatamente um bloco "Início".', grave: true });
  }

  for (const l of g.ligacoes) {
    if (!ids.has(l.de) || !ids.has(l.para)) {
      problemas.push({ noId: l.de, mensagem: 'Há uma seta ligada a um bloco que não existe mais.', grave: false });
    }
  }

  const saidaLigada = (noId: string, saida: string) => g.ligacoes.some((l) => l.de === noId && l.saida === saida);

  if (inicio[0] && !saidaLigada(inicio[0].id, 'proximo')) {
    problemas.push({ noId: inicio[0].id, mensagem: 'Ligue o "Início" ao primeiro bloco.', grave: true });
  }

  for (const no of g.nos) {
    const nome = textoDoNo(no);
    switch (no.tipo) {
      case 'mensagem': {
        const d = no.dados;
        if (!d.blocos.length) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": a mensagem está vazia.`, grave: true });
        }
        d.blocos.forEach((b, i) => {
          if (b.tipo === 'texto') {
            if (!b.texto.trim()) {
              problemas.push({ noId: no.id, mensagem: `"${nome}": o texto ${i + 1} está vazio.`, grave: true });
            }
            if (b.texto.length > LIMITES.texto) {
              problemas.push({ noId: no.id, mensagem: `"${nome}": texto passa de ${LIMITES.texto} caracteres.`, grave: true });
            }
          } else if (!/^https:\/\//i.test(b.url)) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": a mídia ${i + 1} precisa de um link https.`, grave: true });
          }
        });
        const it = d.interacao;
        if (it.tipo !== 'nenhuma') {
          const ultimo = d.blocos[d.blocos.length - 1];
          if (!ultimo || ultimo.tipo !== 'texto') {
            problemas.push({
              noId: no.id,
              mensagem: `"${nome}": botões, lista e link vão presos a um TEXTO — termine o bloco com um texto.`,
              grave: true,
            });
          } else if (ultimo.texto.length > LIMITES.textoInterativo) {
            problemas.push({
              noId: no.id,
              mensagem: `"${nome}": texto com botões/lista pode ter no máximo ${LIMITES.textoInterativo} caracteres.`,
              grave: true,
            });
          }
        }
        if (it.tipo === 'botoes') {
          if (!it.botoes.length || it.botoes.length > LIMITES.botoes) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": use de 1 a ${LIMITES.botoes} botões.`, grave: true });
          }
          const titulos = new Set<string>();
          for (const b of it.botoes) {
            const t = b.titulo.trim();
            if (!t) problemas.push({ noId: no.id, mensagem: `"${nome}": há botão sem texto.`, grave: true });
            if (t.length > LIMITES.tituloBotao) {
              problemas.push({ noId: no.id, mensagem: `"${nome}": o botão "${t}" passa de ${LIMITES.tituloBotao} caracteres.`, grave: true });
            }
            if (titulos.has(t.toLowerCase())) {
              problemas.push({ noId: no.id, mensagem: `"${nome}": dois botões com o mesmo texto — a Meta recusa.`, grave: true });
            }
            titulos.add(t.toLowerCase());
            if (!saidaLigada(no.id, b.id)) {
              problemas.push({ noId: no.id, mensagem: `"${nome}": o botão "${t || '?'}" não leva a lugar nenhum.`, grave: false });
            }
          }
        }
        if (it.tipo === 'lista') {
          const itens = it.secoes.flatMap((s) => s.itens);
          if (!itens.length || itens.length > LIMITES.itensLista) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": a lista precisa de 1 a ${LIMITES.itensLista} opções.`, grave: true });
          }
          if (!it.rotuloBotao.trim() || it.rotuloBotao.length > LIMITES.rotuloBotaoLista) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": o botão que abre a lista precisa de 1 a ${LIMITES.rotuloBotaoLista} caracteres.`, grave: true });
          }
          for (const i of itens) {
            if (!i.titulo.trim() || i.titulo.length > LIMITES.tituloItem) {
              problemas.push({ noId: no.id, mensagem: `"${nome}": opção "${i.titulo}" precisa de 1 a ${LIMITES.tituloItem} caracteres.`, grave: true });
            }
            if ((i.descricao ?? '').length > LIMITES.descricaoItem) {
              problemas.push({ noId: no.id, mensagem: `"${nome}": a descrição de "${i.titulo}" passa de ${LIMITES.descricaoItem}.`, grave: true });
            }
          }
          if (it.secoes.length > 1 && it.secoes.some((s) => !s.titulo.trim())) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": com mais de uma seção, toda seção precisa de título.`, grave: true });
          }
        }
        if (it.tipo === 'link') {
          if (!/^https?:\/\//i.test(it.url)) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": o botão de link precisa de um endereço http(s).`, grave: true });
          }
          if (!it.rotulo.trim() || it.rotulo.length > LIMITES.tituloBotao) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": o texto do botão de link precisa de 1 a ${LIMITES.tituloBotao} caracteres.`, grave: true });
          }
        }
        if ((d.cabecalho ?? '').length > LIMITES.cabecalho) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": cabeçalho passa de ${LIMITES.cabecalho} caracteres.`, grave: true });
        }
        if ((d.rodape ?? '').length > LIMITES.rodape) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": rodapé passa de ${LIMITES.rodape} caracteres.`, grave: true });
        }
        break;
      }
      case 'template':
        if (!no.dados.nome) problemas.push({ noId: no.id, mensagem: `"${nome}": escolha o template.`, grave: true });
        break;
      case 'pergunta':
        if (!no.dados.pergunta.trim()) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": escreva a pergunta.`, grave: true });
        }
        if ((no.dados.sugestoes ?? []).length > LIMITES.botoes) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": no máximo ${LIMITES.botoes} sugestões.`, grave: true });
        }
        if ((no.dados.sugestoes ?? []).some((s) => !s.trim() || s.length > LIMITES.tituloBotao)) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": sugestões precisam de 1 a ${LIMITES.tituloBotao} caracteres.`, grave: true });
        }
        break;
      case 'aguardar':
        if (!(no.dados.quantidade > 0)) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": o tempo de espera precisa ser maior que zero.`, grave: true });
        }
        break;
      case 'condicao':
        if (!no.dados.regras.length) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": adicione pelo menos uma regra.`, grave: true });
        }
        break;
      case 'acao':
        if (!no.dados.acoes.length) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": adicione pelo menos uma ação.`, grave: false });
        }
        for (const a of no.dados.acoes) {
          if ((a.tipo === 'adicionar_tag' || a.tipo === 'remover_tag') && !a.tag.trim()) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": ação de tag sem tag.`, grave: true });
          }
          if ((a.tipo === 'definir_campo' || a.tipo === 'limpar_campo') && !a.chave) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": escolha o campo.`, grave: true });
          }
          if (a.tipo === 'webhook' && !/^https:\/\//i.test(a.url)) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": o webhook precisa de endereço https.`, grave: true });
          }
          if (a.tipo === 'notificar_equipe' && !/.+@.+\..+/.test(a.email)) {
            problemas.push({ noId: no.id, mensagem: `"${nome}": e-mail da equipe inválido.`, grave: true });
          }
        }
        break;
      case 'randomizador':
        if (no.dados.variantes.length < 2) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": o teste A/B precisa de pelo menos 2 caminhos.`, grave: true });
        }
        if (no.dados.variantes.every((v) => !(v.peso > 0))) {
          problemas.push({ noId: no.id, mensagem: `"${nome}": todos os pesos estão zerados.`, grave: true });
        }
        break;
      case 'ir_para':
        if (!no.dados.fluxoId) problemas.push({ noId: no.id, mensagem: `"${nome}": escolha para qual fluxo ir.`, grave: true });
        break;
    }
  }

  // Blocos soltos: ninguém chega neles, então nunca vão rodar.
  const alcancaveis = new Set<string>();
  const fila = inicio.map((n) => n.id);
  while (fila.length) {
    const atual = fila.shift()!;
    if (alcancaveis.has(atual)) continue;
    alcancaveis.add(atual);
    for (const l of g.ligacoes) if (l.de === atual) fila.push(l.para);
  }
  for (const no of g.nos) {
    if (!alcancaveis.has(no.id)) {
      problemas.push({ noId: no.id, mensagem: `"${textoDoNo(no)}" está solto — nenhuma seta chega nele.`, grave: false });
    }
  }

  return problemas;
}

// ── Nomes para a tela ────────────────────────────────────────────────────────────

export const ROTULO_TIPO: Record<TipoNo, string> = {
  inicio: 'Início',
  mensagem: 'Mensagem',
  template: 'Template (fora das 24 h)',
  pergunta: 'Pergunta',
  aguardar: 'Aguardar',
  condicao: 'Condição',
  acao: 'Ações',
  randomizador: 'Teste A/B',
  ir_para: 'Ir para outro fluxo',
  fim: 'Fim',
};

export const TIPOS_GATILHO = [
  'palavra_chave',
  'boas_vindas',
  'padrao',
  'link_ref',
  'anuncio',
  'tag_adicionada',
  'webhook',
] as const;
export type TipoGatilho = (typeof TIPOS_GATILHO)[number];

export const ROTULO_GATILHO: Record<TipoGatilho, string> = {
  palavra_chave: 'Palavra-chave',
  boas_vindas: 'Mensagem de boas-vindas',
  padrao: 'Resposta padrão',
  link_ref: 'Link de referência (wa.me)',
  anuncio: 'Anúncio de clique para o WhatsApp',
  tag_adicionada: 'Tag adicionada',
  webhook: 'Webhook externo (LP, n8n)',
};

export interface GatilhoConfig {
  palavras?: string[];
  modo?: 'contem' | 'exata' | 'comeca';
  codigo?: string;
  texto?: string;
  ad_ids?: string[];
  tag?: string;
  intervalo_horas?: number;
  token?: string;
}

export interface Gatilho {
  id: string;
  fluxo_id: string;
  tipo: TipoGatilho;
  config: GatilhoConfig;
  ativo: boolean;
  prioridade: number;
  disparos: number;
  criado_em: string;
}

export interface Fluxo {
  id: string;
  nome: string;
  descricao: string | null;
  connection_id: string | null;
  status: 'rascunho' | 'ativo' | 'pausado';
  grafo: Grafo;
  pasta: string | null;
  execucoes_total: number;
  concluidas_total: number;
  criado_em: string;
  atualizado_em: string;
}

export interface CampoPersonalizado {
  id: string;
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'numero' | 'data' | 'sim_nao' | 'email' | 'telefone';
  descricao: string | null;
  criado_em: string;
}

export interface Conversa {
  id: string;
  connection_id: string;
  contact_id: string | null;
  wa_id: string;
  nome_perfil: string | null;
  ultima_entrada_em: string | null;
  ultima_mensagem_em: string | null;
  ultima_previa: string | null;
  nao_lidas: number;
  automacao_pausada_ate: string | null;
  status: 'aberta' | 'fechada';
  criado_em: string;
}

export interface MensagemConversa {
  id: string;
  conversa_id: string;
  direcao: 'in' | 'out';
  tipo: string;
  texto: string | null;
  payload: Record<string, unknown> | null;
  wamid: string | null;
  status: 'enviado' | 'entregue' | 'lido' | 'falha' | null;
  erro: string | null;
  origem: 'fluxo' | 'manual' | 'campanha' | 'teste' | null;
  fluxo_id: string | null;
  no_id: string | null;
  criado_em: string;
}

// ── Janela de 24 h ───────────────────────────────────────────────────────────────

export const JANELA_MS = 24 * 60 * 60 * 1000;

/** A janela está aberta? Conta da ÚLTIMA mensagem da pessoa. Margem de 2 min. */
export function janelaAberta(ultimaEntradaEm: string | null | undefined, agora = Date.now()): boolean {
  if (!ultimaEntradaEm) return false;
  const t = new Date(ultimaEntradaEm).getTime();
  return Number.isFinite(t) && agora - t < JANELA_MS - 2 * 60_000;
}

// ── Fábrica de nós (editor) ──────────────────────────────────────────────────────

export function novoId(prefixo = 'n'): string {
  return `${prefixo}_${Math.random().toString(36).slice(2, 9)}`;
}

export function noPadrao(tipo: TipoNo, x: number, y: number): No {
  const id = novoId(tipo.slice(0, 3));
  switch (tipo) {
    case 'inicio':
      return { id, tipo, x, y, dados: {} };
    case 'mensagem':
      return {
        id,
        tipo,
        x,
        y,
        dados: { blocos: [{ tipo: 'texto', texto: '' }], interacao: { tipo: 'nenhuma' }, digitando: true },
      };
    case 'template':
      return { id, tipo, x, y, dados: { nome: '', idioma: 'pt_BR', variaveis: {}, botoes: [] } };
    case 'pergunta':
      return {
        id,
        tipo,
        x,
        y,
        dados: {
          pergunta: '',
          tipoResposta: 'texto',
          salvarEm: null,
          sugestoes: [],
          mensagemErro: 'Não entendi. Pode mandar de novo?',
          tentativas: 2,
          esperarMinutos: 0,
        },
      };
    case 'aguardar':
      return { id, tipo, x, y, dados: { quantidade: 1, unidade: 'dias', janelaInicio: null, janelaFim: null } };
    case 'condicao':
      return { id, tipo, x, y, dados: { combinar: 'todas', regras: [{ campo: 'tag', operador: 'tem', valor: '' }] } };
    case 'acao':
      return { id, tipo, x, y, dados: { acoes: [] } };
    case 'randomizador':
      return {
        id,
        tipo,
        x,
        y,
        dados: {
          variantes: [
            { id: novoId('v'), nome: 'A', peso: 50 },
            { id: novoId('v'), nome: 'B', peso: 50 },
          ],
        },
      };
    case 'ir_para':
      return { id, tipo, x, y, dados: { fluxoId: null } };
    case 'fim':
      return { id, tipo, x, y, dados: {} };
  }
}

/** O grafo de um fluxo recém-criado: Início → Mensagem. */
export function grafoInicial(): Grafo {
  const inicio = noPadrao('inicio', 60, 200);
  const msg = noPadrao('mensagem', 380, 160);
  return {
    nos: [inicio, msg],
    ligacoes: [{ id: novoId('l'), de: inicio.id, saida: 'proximo', para: msg.id }],
  };
}
