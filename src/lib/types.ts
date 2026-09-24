import type { CategoriaKey } from './categories';

export type CampaignType = 'texto' | 'imagem' | 'video' | 'pdf' | 'enquete';
/** Os tipos que levam arquivo anexado (a enquete e o texto não levam). */
export type TipoComMidia = 'imagem' | 'video' | 'pdf';

/** Tem arquivo anexado? Serve de guarda de tipo para os mapas por TipoComMidia. */
export function temMidia(tipo: CampaignType): tipo is TipoComMidia {
  return tipo === 'imagem' || tipo === 'video' || tipo === 'pdf';
}
export type CampaignStatus =
  | 'rascunho' | 'agendada' | 'enviando' | 'enviada' | 'cancelada' | 'erro';

export interface Group {
  id: string;
  group_id: string;
  nome: string;
  ativo: boolean;
  criado_em: string;
  /** Conexão dona do grupo. Nulo em grupos legados, cadastrados antes das conexões. */
  connection_id?: string | null;
  participantes?: number | null;
  foto_url?: string | null;
  sincronizado_em?: string | null;
  /** Tags do grupo (ids de `group_tags`). Montado pela API a partir da tabela de ligação. */
  tag_ids?: string[];
}

export interface GroupTag {
  id: string;
  nome: string;
  /** Cor em hex (#RRGGBB), usada no selo da tag. */
  cor: string;
  criado_em: string;
}

export interface Audience {
  id: string;
  nome: string;
  tipo: 'todos' | 'manual';
  group_ids: string[] | null;
  criado_em: string;
}

export interface CampaignResult {
  total: number;
  enviados: number;
  falhas: number;
  erro?: string;
}

export interface SequenceStep {
  id: string;
  ordem: number;
  dia_offset: number;            // 0 = dia da aula, -1 = 1 dia antes, -2 = 2 dias antes
  hora_tipo: 'fixo' | 'relativo';
  hora_fixa: string | null;      // 'HH:MM' quando fixo
  offset_min: number | null;     // minutos vs. hora da aula quando relativo
  mensagem: string;
  tipo: CampaignType;
  midia_url: string | null;
  mencionar_todos: boolean;
}

export interface Sequence {
  id: string;
  nome: string;
  categoria: CategoriaKey;
  steps: SequenceStep[];
  criado_em: string;
  atualizado_em: string;
}

export interface Campaign {
  id: string;
  nome: string;
  tipo: CampaignType;
  categoria: CategoriaKey;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  /** Enquete: as opções, na ordem. A pergunta é a `mensagem`. */
  enquete_opcoes?: string[] | null;
  /** Enquete: a pessoa pode marcar mais de uma opção. */
  enquete_multipla?: boolean;
  audience_id: string | null;
  group_ids: string[] | null;
  /** Para quem a campanha vai: os grupos cadastrados ou os contatos de uma lista. */
  alvo: 'grupos' | 'contatos';
  list_ids: string[] | null;
  /** Número que dispara. Nulo = o motor usa a primeira conexão conectada. */
  connection_id: string | null;
  /** Template aprovado na Meta. Obrigatório quando `alvo = 'contatos'`. */
  template_nome?: string | null;
  template_idioma?: string | null;
  /** Posição da Meta → texto, ainda com os marcadores `{{primeiro_nome}}` do sistema. */
  template_variaveis?: Record<string, string> | null;
  template_cabecalho_url?: string | null;
  /** A fila desta campanha terminou de ser montada? Ver 0019. */
  fanout_completo?: boolean;
  fanout_cursor?: string | null;
  enviar_em: string | null;
  status: CampaignStatus;
  /** Preenchido quando a campanha foi materializada por uma recorrência semanal. */
  recorrencia_id?: string | null;
  resultado: CampaignResult | null;
  enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Recorrencia {
  id: string;
  nome: string;
  categoria: CategoriaKey;
  dia_semana: number;            // 0 = domingo … 6 = sábado (Date#getDay())
  hora: string;                  // 'HH:MM' no relógio de São Paulo
  tipo: CampaignType;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  audience_id: string | null;
  group_ids: string[] | null;
  connection_id?: string | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Conexões de WhatsApp (Evolution API)
// ─────────────────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'desconectada' | 'conectando' | 'conectada' | 'erro';

/**
 * Os dois conectores. Não são intercambiáveis, e a diferença é funcional:
 *   • `evolution` — chip por QR Code. É o ÚNICO que envia para GRUPO, e o único que
 *     manda texto livre para quem nunca escreveu. Em compensação tem teto de ~500/dia.
 *   • `cloud` — API oficial da Meta. É o único que aguenta disparo em massa 1-a-1,
 *     com template aprovado. Não envia para grupo.
 * A regra de qual campanha usa qual está na 0019, em trigger, e em `validarCanal()`.
 */
export type ConnectionProvider = 'evolution' | 'cloud';

export interface Connection {
  id: string;
  nome: string;
  provider: ConnectionProvider;
  /** Instância na Evolution. Nulo nas conexões da API oficial. */
  instance_name: string | null;
  /** Identificador do número na Meta. Nulo nas conexões da Evolution. */
  phone_number_id?: string | null;
  waba_id?: string | null;
  /** Ritmo da Cloud API, em mensagens por segundo. Não se aplica à Evolution. */
  msgs_por_segundo?: number;
  /** Id do token no Vault (conectado pelo botão da Meta). Nulo = token do ambiente. */
  segredo_id?: string | null;
  modo_meta?: 'cloud' | 'coexistencia' | null;
  webhook_apontado_em?: string | null;
  ultima_entrada_em?: string | null;
  /** Termômetro da Meta: quando cai para RED, o teto diário despenca. */
  qualidade?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | null;
  numero: string | null;
  profile_name: string | null;
  profile_pic_url: string | null;
  status: ConnectionStatus;
  delay_min_seg: number;
  delay_max_seg: number;
  limite_diario: number;
  ativo: boolean;
  proximo_envio_em: string | null;
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Templates da API oficial (Meta)
// ─────────────────────────────────────────────────────────────────────────────────

export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL';

export interface WhatsAppTemplate {
  id: string;
  connection_id: string;
  nome: string;
  idioma: string;
  categoria: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  status: TemplateStatus;
  /** Texto do corpo com os marcadores da Meta: `Oi {{1}}, a turma do {{2}} abriu.` */
  corpo: string;
  cabecalho_tipo: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null;
  cabecalho_texto: string | null;
  rodape: string | null;
  botoes: unknown[] | null;
  variaveis_corpo: number;
  variaveis_cabecalho: number;
  meta_id: string | null;
  sincronizado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Fila de envio do WhatsApp
// ─────────────────────────────────────────────────────────────────────────────────

export type RecipientStatus =
  | 'pendente' | 'enviando' | 'enviado' | 'entregue' | 'lido' | 'falha' | 'cancelado';

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  connection_id: string | null;
  destino: string;
  destino_nome: string | null;
  destino_tipo: 'grupo' | 'contato';
  contact_id: string | null;
  status: RecipientStatus;
  tentativas: number;
  provider_message_id: string | null;
  erro: string | null;
  /** Código cru do erro da Meta (131026, 132001…). Sem ele, "falha" é adivinhação. */
  codigo_erro?: string | null;
  /** Variáveis do template já resolvidas para esta pessoa, no fan-out. */
  variaveis?: Record<string, string> | null;
  enviado_em: string | null;
  entregue_em: string | null;
  lido_em: string | null;
  respondido_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// Contatos e listas (compartilhados pelos dois canais)
// ─────────────────────────────────────────────────────────────────────────────────

export type StatusEmail = 'ativo' | 'descadastrado' | 'bounce' | 'spam';
export type StatusWhatsApp = 'ativo' | 'descadastrado' | 'invalido';

export interface Contact {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  tags: string[];
  status_email: StatusEmail;
  status_whatsapp: StatusWhatsApp;
  origem: string | null;
  campos: Record<string, string>;
  descadastrado_em: string | null;
  /** Quando a pessoa pediu para sair do WhatsApp (respondeu "PARAR"). */
  optout_whatsapp_em?: string | null;
  /** Pontuação por engajamento (0023) — pesos em app_settings.score. */
  score?: number;
  criado_em: string;
  atualizado_em: string;
}

export interface Lista {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  criado_em: string;
  atualizado_em: string;
  /** Preenchido pelas rotas que pedem a contagem junto. */
  total?: number;
}

// ─────────────────────────────────────────────────────────────────────────────────
// E-mail marketing
// ─────────────────────────────────────────────────────────────────────────────────

export type EmailCampaignStatus =
  | 'rascunho' | 'agendada' | 'enviando' | 'enviada' | 'cancelada' | 'erro';

export interface EmailCampaign {
  id: string;
  nome: string;
  assunto: string;
  assunto_b: string | null;
  preheader: string | null;
  remetente_nome: string;
  remetente_email: string;
  responder_para: string | null;
  html: string;
  texto: string | null;
  list_ids: string[];
  /** Segmento salvo como público (0023). Com listas junto, vale quem está nos dois. */
  segment_id?: string | null;
  tags: string[];
  status: EmailCampaignStatus;
  enviar_em: string | null;
  enviado_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

export type EmailRecipientStatus =
  | 'pendente' | 'enviando' | 'enviado' | 'entregue' | 'aberto' | 'clicado'
  | 'bounce' | 'spam' | 'falha' | 'cancelado';

export interface EmailRecipient {
  id: string;
  campaign_id: string;
  contact_id: string | null;
  email: string;
  nome: string | null;
  token: string;
  variante: 'A' | 'B';
  status: EmailRecipientStatus;
  tentativas: number;
  provider_message_id: string | null;
  erro: string | null;
  enviado_em: string | null;
  entregue_em: string | null;
  primeiro_aberto_em: string | null;
  ultimo_aberto_em: string | null;
  primeiro_clique_em: string | null;
  aberturas: number;
  cliques: number;
  criado_em: string;
  atualizado_em: string;
}

export interface EmailTemplate {
  id: string;
  nome: string;
  descricao: string | null;
  assunto_sugerido: string | null;
  html: string;
  criado_em: string;
  atualizado_em: string;
}

// ─────────────────────────────────────────────────────────────────────────────────
// KPIs (espelham as visões de 0010_kpis.sql)
// ─────────────────────────────────────────────────────────────────────────────────

export interface CampaignKpi {
  campaign_id: string;
  nome: string;
  categoria: CategoriaKey;
  status: CampaignStatus;
  alvo: 'grupos' | 'contatos';
  connection_id: string | null;
  enviar_em: string | null;
  enviado_em: string | null;
  destinatarios: number;
  enviados: number;
  entregues: number;
  lidos: number;
  respostas: number;
  falhas: number;
  pendentes: number;
  taxa_entrega: number | null;
  taxa_leitura: number | null;
  taxa_resposta: number | null;
  taxa_falha: number | null;
  seg_ate_entrega_mediana: number | null;
  seg_ate_leitura_mediana: number | null;
  primeiro_envio_em: string | null;
  ultimo_envio_em: string | null;
}

export interface EmailKpi {
  campaign_id: string;
  nome: string;
  assunto: string;
  status: EmailCampaignStatus;
  enviar_em: string | null;
  enviado_em: string | null;
  destinatarios: number;
  enviados: number;
  entregues: number;
  abriram: number;
  clicaram: number;
  aberturas_totais: number;
  cliques_totais: number;
  bounces: number;
  spam: number;
  falhas: number;
  pendentes: number;
  taxa_entrega: number | null;
  taxa_abertura: number | null;
  taxa_clique: number | null;
  ctor: number | null;
  taxa_bounce: number | null;
  taxa_spam: number | null;
  seg_ate_abertura_mediana: number | null;
}

export interface DestinoKpi {
  destino: string;
  destino_nome: string | null;
  destino_tipo: 'grupo' | 'contato';
  recebidas: number;
  entregues: number;
  lidas: number;
  respostas: number;
  falhas: number;
  taxa_leitura: number | null;
  ultimo_envio_em: string | null;
}

export interface KpiDiario {
  dia: string;
  canal: 'whatsapp' | 'email';
  enviados: number;
  entregues: number;
  engajados: number;
  acoes: number;
  falhas: number;
}

export interface EmailLinkKpi {
  campaign_id: string;
  url: string;
  cliques: number;
  pessoas: number;
  primeiro_clique_em: string;
}

export interface EmailAbKpi {
  campaign_id: string;
  variante: 'A' | 'B';
  assunto: string | null;
  destinatarios: number;
  entregues: number;
  abriram: number;
  clicaram: number;
  taxa_abertura: number | null;
  taxa_clique: number | null;
}

export interface ContatoEngajamento {
  contact_id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  tags: string[];
  status_email: StatusEmail;
  status_whatsapp: StatusWhatsApp;
  emails_recebidos: number;
  emails_abertos: number;
  emails_clicados: number;
  whatsapp_recebidas: number;
  whatsapp_lidas: number;
  ultima_interacao: string | null;
  nota_engajamento: number;
}
