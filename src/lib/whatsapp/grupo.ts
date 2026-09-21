// Tradução dos dados de grupo da Evolution (formato Baileys) para a tela de
// configurações do grupo. Separado do cliente HTTP para dar para testar sem rede.
//
// A pegadinha que mora aqui: desde 2025 o WhatsApp endereça participante por LID
// (`123456789@lid`), um id que NÃO é o telefone. O telefone, quando existe, vem ao lado
// em `phoneNumber` (ou `jid`). Por isso "quem sou eu no grupo" compara as duas coisas.

export type Papel = 'dono' | 'admin' | null;

export interface Participante {
  /** Id que o WhatsApp usa para ESTA pessoa neste grupo (pode ser @lid). É o que vai nas ações. */
  jid: string;
  /** Telefone só com dígitos, quando o WhatsApp revela. */
  telefone: string | null;
  nome: string | null;
  foto: string | null;
  papel: Papel;
}

export interface InfoGrupo {
  jid: string;
  nome: string;
  descricao: string;
  foto: string | null;
  /** Só admins enviam mensagens ("announcement"). */
  soAdminsEnviam: boolean;
  /** Só admins editam nome, foto e descrição ("restrict"). */
  soAdminsEditam: boolean;
  criadoEm: number | null;
  total: number;
  participantes: Participante[];
  /** O número conectado é admin/dono? `null` = não deu para saber (LID sem telefone). */
  meuPapel: Papel | 'membro' | null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** `5511999999999@s.whatsapp.net` / `5511999999999:12@s.whatsapp.net` → `5511999999999`. */
export function digitosDoJid(jid: string | null | undefined): string | null {
  if (!jid || !/@s\.whatsapp\.net$|@c\.us$/.test(jid)) return null;
  const d = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return d || null;
}

export function lerPapel(v: unknown): Papel {
  if (v === 'superadmin') return 'dono';
  if (v === 'admin') return 'admin';
  return null;
}

export function paraParticipante(bruto: unknown): Participante | null {
  const p = obj(bruto);
  const jid = str(p.id);
  if (!jid) return null;
  const telefone = digitosDoJid(jid) ?? digitosDoJid(str(p.phoneNumber)) ?? digitosDoJid(str(p.jid));
  return {
    jid,
    telefone,
    nome: str(p.name) ?? str(p.notify) ?? str(p.verifiedName),
    foto: str(p.imgUrl),
    papel: lerPapel(p.admin),
  };
}

/** Admins primeiro (dono no topo), depois por nome — como o WhatsApp mostra. */
export function ordenarParticipantes(lista: Participante[]): Participante[] {
  const peso = (p: Participante) => (p.papel === 'dono' ? 0 : p.papel === 'admin' ? 1 : 2);
  return [...lista].sort(
    (a, b) =>
      peso(a) - peso(b) ||
      (a.nome ?? a.telefone ?? a.jid).localeCompare(b.nome ?? b.telefone ?? b.jid, 'pt-BR', { sensitivity: 'base' }),
  );
}

/**
 * Qual o papel do número conectado no grupo. Compara pelo telefone porque o id dele no
 * grupo pode ser um LID que o SendFlow não conhece.
 */
export function meuPapel(participantes: Participante[], meuNumero: string | null): InfoGrupo['meuPapel'] {
  const meu = (meuNumero ?? '').replace(/\D/g, '');
  if (!meu) return null;
  const eu = participantes.find((p) => p.telefone === meu);
  if (eu) return eu.papel ?? 'membro';
  // Ninguém com o meu telefone, mas há participantes sem telefone (LID): não dá para afirmar.
  return participantes.some((p) => !p.telefone) ? null : 'membro';
}

/**
 * Junta `findGroupInfos` (regras) com `participants` (nomes e fotos). A lista de
 * participantes do segundo é a mais rica; quando vem vazia, usa a do primeiro.
 */
export function paraInfoGrupo(infoBruta: unknown, participantesBrutos: unknown[], meuNumero: string | null): InfoGrupo {
  const g = obj(infoBruta);
  const origem = participantesBrutos.length ? participantesBrutos : Array.isArray(g.participants) ? g.participants : [];
  const participantes = ordenarParticipantes(
    origem.map(paraParticipante).filter((p): p is Participante => p !== null),
  );
  const criado = Number(g.creation);
  return {
    jid: str(g.id) ?? '',
    nome: str(g.subject) ?? 'Grupo sem nome',
    descricao: typeof g.desc === 'string' ? g.desc : '',
    foto: str(g.pictureUrl),
    soAdminsEnviam: g.announce === true,
    soAdminsEditam: g.restrict === true,
    criadoEm: Number.isFinite(criado) && criado > 0 ? criado : null,
    total: typeof g.size === 'number' ? g.size : participantes.length,
    participantes,
    meuPapel: meuPapel(participantes, meuNumero),
  };
}

/** O que o WhatsApp respondeu para cada pessoa numa ação de participante → frase para a tela. */
export function explicarStatusParticipante(status: string, acao: 'add' | 'remove' | 'promote' | 'demote'): string | null {
  if (status === '200' || status === '') return null;
  if (status === '403') {
    return acao === 'add'
      ? 'a privacidade da pessoa não deixa adicionar direto — mande o link de convite'
      : 'o WhatsApp recusou (o número precisa ser admin)';
  }
  if (status === '408') return 'saiu do grupo há pouco e o WhatsApp bloqueia a volta por um tempo — mande o link';
  if (status === '409') return acao === 'add' ? 'já está no grupo' : 'conflito no WhatsApp';
  if (status === '404') return 'número sem WhatsApp';
  if (status === '401') return 'o WhatsApp bloqueou (a pessoa bloqueou o número?)';
  if (status === '500') return 'grupo lotado ou erro do WhatsApp';
  return `recusado pelo WhatsApp (código ${status})`;
}
