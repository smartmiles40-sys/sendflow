// Segmentos de contatos — o "Segment builder" do ActiveCampaign.
//
// As regras são JSON e quem as RESOLVE é o banco (`sf_filtrar_contatos`, 0023). Este
// arquivo é a outra metade do contrato: a lista fechada de campos e operadores que a
// tela oferece, e a validação que roda antes de mandar para o banco. As duas listas
// precisam andar juntas — um operador que existe aqui e não em `sf_condicao_sql` faz o
// banco recusar o segmento (de propósito: filtro não entendido nunca vira "todo mundo").

export type CampoSegmento =
  | 'tag'
  | 'lista'
  | 'nome'
  | 'email'
  | 'telefone'
  | 'empresa'
  | 'origem'
  | 'status_email'
  | 'status_whatsapp'
  | 'campo'
  | 'criado'
  | 'abriu_email'
  | 'clicou_email'
  | 'score';

export interface Condicao {
  campo: CampoSegmento;
  op: string;
  valor?: string;
  /** Só para `campo = 'campo'`: a chave do campo personalizado. */
  chave?: string;
}

export interface Regras {
  combinar: 'todas' | 'qualquer';
  /** Um item pode ser outro grupo de regras (só o servidor monta isso — ver somarFiltros). */
  condicoes: (Condicao | Regras)[];
}

export const REGRAS_VAZIAS: Regras = { combinar: 'todas', condicoes: [] };

/** Que tipo de valor o operador pede — decide o campo que a tela desenha. */
export type TipoValor = 'nenhum' | 'texto' | 'numero' | 'dias' | 'tag' | 'lista' | 'campanha' | 'status_email' | 'status_whatsapp';

export interface Operador {
  op: string;
  rotulo: string;
  valor: TipoValor;
}

const TEXTO: Operador[] = [
  { op: 'contem', rotulo: 'contém', valor: 'texto' },
  { op: 'nao_contem', rotulo: 'não contém', valor: 'texto' },
  { op: 'igual', rotulo: 'é igual a', valor: 'texto' },
  { op: 'diferente', rotulo: 'é diferente de', valor: 'texto' },
  { op: 'preenchido', rotulo: 'está preenchido', valor: 'nenhum' },
  { op: 'vazio', rotulo: 'está vazio', valor: 'nenhum' },
];

const EMAIL_ENGAJAMENTO = (verbo: string): Operador[] => [
  { op: 'ultimos_dias', rotulo: `${verbo} algum e-mail nos últimos`, valor: 'dias' },
  { op: 'nao_ultimos_dias', rotulo: `não ${verbo} nenhum e-mail nos últimos`, valor: 'dias' },
  { op: 'nunca', rotulo: `nunca ${verbo} e-mail`, valor: 'nenhum' },
  { op: 'campanha', rotulo: `${verbo} a campanha`, valor: 'campanha' },
  { op: 'nao_campanha', rotulo: `recebeu e não ${verbo} a campanha`, valor: 'campanha' },
];

export const CAMPOS: { campo: CampoSegmento; rotulo: string; grupo: string; ops: Operador[] }[] = [
  {
    campo: 'tag',
    rotulo: 'Tag',
    grupo: 'Contato',
    ops: [
      { op: 'tem', rotulo: 'tem a tag', valor: 'tag' },
      { op: 'nao_tem', rotulo: 'não tem a tag', valor: 'tag' },
    ],
  },
  {
    campo: 'lista',
    rotulo: 'Lista',
    grupo: 'Contato',
    ops: [
      { op: 'esta', rotulo: 'está na lista', valor: 'lista' },
      { op: 'nao_esta', rotulo: 'não está na lista', valor: 'lista' },
    ],
  },
  { campo: 'nome', rotulo: 'Nome', grupo: 'Contato', ops: TEXTO },
  { campo: 'email', rotulo: 'E-mail', grupo: 'Contato', ops: TEXTO },
  { campo: 'telefone', rotulo: 'Telefone', grupo: 'Contato', ops: TEXTO },
  { campo: 'empresa', rotulo: 'Empresa', grupo: 'Contato', ops: TEXTO },
  { campo: 'origem', rotulo: 'Origem', grupo: 'Contato', ops: TEXTO },
  {
    campo: 'campo',
    rotulo: 'Campo personalizado',
    grupo: 'Contato',
    ops: [
      ...TEXTO,
      { op: 'maior', rotulo: 'é maior que', valor: 'numero' },
      { op: 'menor', rotulo: 'é menor que', valor: 'numero' },
    ],
  },
  {
    campo: 'criado',
    rotulo: 'Cadastro',
    grupo: 'Contato',
    ops: [
      { op: 'ultimos_dias', rotulo: 'entrou nos últimos', valor: 'dias' },
      { op: 'mais_de_dias', rotulo: 'entrou há mais de', valor: 'dias' },
    ],
  },
  {
    campo: 'status_email',
    rotulo: 'Situação no e-mail',
    grupo: 'Permissão',
    ops: [
      { op: 'igual', rotulo: 'é', valor: 'status_email' },
      { op: 'diferente', rotulo: 'não é', valor: 'status_email' },
    ],
  },
  {
    campo: 'status_whatsapp',
    rotulo: 'Situação no WhatsApp',
    grupo: 'Permissão',
    ops: [
      { op: 'igual', rotulo: 'é', valor: 'status_whatsapp' },
      { op: 'diferente', rotulo: 'não é', valor: 'status_whatsapp' },
    ],
  },
  { campo: 'abriu_email', rotulo: 'Abertura de e-mail', grupo: 'Engajamento', ops: EMAIL_ENGAJAMENTO('abriu') },
  { campo: 'clicou_email', rotulo: 'Clique em e-mail', grupo: 'Engajamento', ops: EMAIL_ENGAJAMENTO('clicou') },
  {
    campo: 'score',
    rotulo: 'Pontuação',
    grupo: 'Engajamento',
    ops: [
      { op: 'maior_igual', rotulo: 'é pelo menos', valor: 'numero' },
      { op: 'menor', rotulo: 'é menor que', valor: 'numero' },
    ],
  },
];

export const STATUS_EMAIL = [
  { valor: 'ativo', rotulo: 'ativo' },
  { valor: 'descadastrado', rotulo: 'descadastrado' },
  { valor: 'bounce', rotulo: 'bounce' },
  { valor: 'spam', rotulo: 'marcou spam' },
];

export const STATUS_WHATSAPP = [
  { valor: 'ativo', rotulo: 'ativo' },
  { valor: 'descadastrado', rotulo: 'pediu para sair' },
  { valor: 'invalido', rotulo: 'número inválido' },
];

export function definicaoDoCampo(campo: string) {
  return CAMPOS.find((c) => c.campo === campo) ?? null;
}

export function operador(campo: string, op: string): Operador | null {
  return definicaoDoCampo(campo)?.ops.find((o) => o.op === op) ?? null;
}

/** Uma condição nova, já válida no formato (o valor a pessoa preenche). */
export function condicaoPadrao(campo: CampoSegmento = 'tag'): Condicao {
  const def = definicaoDoCampo(campo) ?? CAMPOS[0];
  const primeiro = def.ops[0];
  return {
    campo: def.campo,
    op: primeiro.op,
    valor: primeiro.valor === 'dias' ? '30' : '',
    ...(def.campo === 'campo' ? { chave: '' } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Confere e limpa as regras vindas da tela ou da API. Devolve o erro em português da
 * PRIMEIRA condição que não fecha — melhor recusar do que o banco lançar lá dentro.
 */
export function validarRegras(entrada: unknown): { ok: true; regras: Regras } | { ok: false; erro: string } {
  const bruto = (entrada ?? {}) as { combinar?: unknown; condicoes?: unknown };
  const combinar = bruto.combinar === 'qualquer' ? 'qualquer' : 'todas';
  const lista = Array.isArray(bruto.condicoes) ? bruto.condicoes : [];
  if (lista.length > 30) return { ok: false, erro: 'No máximo 30 condições por segmento.' };

  const condicoes: Condicao[] = [];
  for (const [i, item] of lista.entries()) {
    const c = (item ?? {}) as Record<string, unknown>;
    const campo = String(c.campo ?? '');
    const op = String(c.op ?? '');
    const oper = operador(campo, op);
    const n = i + 1;
    if (!oper) return { ok: false, erro: `Condição ${n}: escolha o campo e a regra.` };
    const valor = String(c.valor ?? '').trim();
    const limpa: Condicao = { campo: campo as CampoSegmento, op };

    if (campo === 'campo') {
      const chave = String(c.chave ?? '').trim();
      if (!/^[a-z0-9_]{1,60}$/.test(chave)) return { ok: false, erro: `Condição ${n}: escolha o campo personalizado.` };
      limpa.chave = chave;
    }

    switch (oper.valor) {
      case 'nenhum':
        break;
      case 'dias':
      case 'numero': {
        const ehInteiro = oper.valor === 'dias' || campo === 'score';
        const ok = ehInteiro ? /^\d{1,5}$/.test(valor) : /^-?\d+(\.\d+)?$/.test(valor);
        if (!ok) return { ok: false, erro: `Condição ${n}: digite um número${oper.valor === 'dias' ? ' de dias' : ''}.` };
        limpa.valor = valor;
        break;
      }
      case 'lista':
      case 'campanha':
        if (!UUID.test(valor)) return { ok: false, erro: `Condição ${n}: escolha ${oper.valor === 'lista' ? 'a lista' : 'a campanha'}.` };
        limpa.valor = valor;
        break;
      default:
        if (!valor) return { ok: false, erro: `Condição ${n}: preencha o valor.` };
        if (valor.length > 200) return { ok: false, erro: `Condição ${n}: valor longo demais.` };
        limpa.valor = valor;
    }
    condicoes.push(limpa);
  }
  return { ok: true, regras: { combinar, condicoes } };
}

/** Os filtros rápidos da tela (lista, tag, situação) viram regras — um caminho só no banco. */
export function regrasDosFiltros(f: { lista?: string | null; tag?: string | null; status_email?: string | null }): Condicao[] {
  const out: Condicao[] = [];
  if (f.lista && UUID.test(f.lista)) out.push({ campo: 'lista', op: 'esta', valor: f.lista });
  if (f.tag) out.push({ campo: 'tag', op: 'tem', valor: f.tag });
  if (f.status_email) out.push({ campo: 'status_email', op: 'igual', valor: f.status_email });
  return out;
}

/**
 * Segmento + filtros rápidos. O segmento entra como um GRUPO: somar "lista X" direto
 * num segmento "qualquer" viraria "lista X OU tag A OU tag B" — gente de fora da lista.
 */
export function somarFiltros(base: Regras, rapidos: Condicao[]): Regras {
  if (!rapidos.length) return base;
  if (!base.condicoes.length) return { combinar: 'todas', condicoes: rapidos };
  if (base.combinar === 'todas') return { combinar: 'todas', condicoes: [...base.condicoes, ...rapidos] };
  return { combinar: 'todas', condicoes: [...rapidos, base] };
}
