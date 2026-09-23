// Peças compartilhadas da caixa de conversa (/conversas): tipos das respostas da API,
// datas no relógio de São Paulo, formatação do texto do WhatsApp e chamadas à API.

import { Fragment } from 'react';
import type { Conversa, MensagemConversa } from '@/lib/automacao/tipos';
import { formatarTelefone } from '@/lib/whatsapp/jid';

export { WA } from '@/app/celular/wa';

export interface ContatoResumo {
  id: string;
  nome: string | null;
  email: string | null;
  tags: string[] | null;
}

export type ConversaLista = Conversa & { contacts: ContatoResumo | null };

export interface ContatoCompleto extends ContatoResumo {
  telefone: string | null;
  campos: Record<string, unknown> | null;
  status_whatsapp: string;
}

export interface ExecucaoResumo {
  id: string;
  fluxo_id: string;
  estado: string;
  no_atual: string | null;
  acordar_em: string | null;
  iniciada_em: string;
  erro: string | null;
  fluxos: { nome: string } | null;
}

export interface DetalheConversa {
  conversa: Conversa;
  contato: ContatoCompleto | null;
  conexao: { id: string; nome: string; numero: string | null; phone_number_id: string | null } | null;
  execucoes: ExecucaoResumo[];
  mensagens: MensagemConversa[];
}

export interface CampoDef {
  id: string;
  chave: string;
  rotulo: string;
  tipo: string;
}

export interface FluxoResumo {
  id: string;
  nome: string;
  status: string;
}

/** O nome que a tela mostra: contato > perfil do WhatsApp > número. */
export function nomeDaConversa(c: Pick<Conversa, 'nome_perfil' | 'wa_id'>, contatoNome?: string | null): string {
  return contatoNome?.trim() || c.nome_perfil?.trim() || formatarTelefone(c.wa_id) || c.wa_id;
}

const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

export function horaDe(iso: string | null | undefined): string {
  return iso ? HORA.format(new Date(iso)) : '';
}

export function rotuloDoDia(iso: string): string {
  const d = DIA.format(new Date(iso));
  if (d === DIA.format(new Date())) return 'Hoje';
  if (d === DIA.format(new Date(Date.now() - 86_400_000))) return 'Ontem';
  return d;
}

/** Na lista: hora se for hoje, "Ontem", ou a data curta. */
export function quandoNaLista(iso: string | null | undefined): string {
  if (!iso) return '';
  const r = rotuloDoDia(iso);
  return r === 'Hoje' ? horaDe(iso) : r === 'Ontem' ? r : r.slice(0, 5);
}

/** "5h", "40 min" — quanto falta até `iso`. */
export function falta(iso: string, agora = Date.now()): string {
  const min = Math.max(0, Math.round((new Date(iso).getTime() - agora) / 60_000));
  if (min < 60) return `${min} min`;
  if (min < 60 * 48) return `${Math.floor(min / 60)}h`;
  return `${Math.round(min / 1440)} dias`;
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

function negritoItalico(texto: string, chave: string): React.ReactNode[] {
  const partes = texto.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return partes.map((p, i) => {
    const k = `${chave}-${i}`;
    if (/^\*[^*]+\*$/.test(p)) return <b key={k}>{p.slice(1, -1)}</b>;
    if (/^_[^_]+_$/.test(p)) return <i key={k}>{p.slice(1, -1)}</i>;
    if (/^~[^~]+~$/.test(p)) return <s key={k}>{p.slice(1, -1)}</s>;
    return <Fragment key={k}>{p}</Fragment>;
  });
}

/** *negrito*, _itálico_, ~riscado~ e links clicáveis — sem innerHTML. */
export function formatarTexto(texto: string): React.ReactNode[] {
  return texto.split(URL_RE).map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={`u${i}`} href={p} target="_blank" rel="noreferrer" className="break-all underline" style={{ color: '#53bdeb' }}>
        {p}
      </a>
    ) : (
      <Fragment key={`t${i}`}>{negritoItalico(p, `t${i}`)}</Fragment>
    ),
  );
}

/** POST de ação na conversa. Devolve a frase do erro, ou null quando deu certo. */
export async function acaoNaConversa(id: string, corpo: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/conversas/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    return b.error ?? 'O servidor recusou.';
  } catch {
    return 'Sem conexão com o servidor.';
  }
}

/** Intervalo que para quando a aba fica escondida e volta (com uma chamada) ao reaparecer. */
export function intervaloVisivel(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const ligar = () => {
    if (timer === null) timer = setInterval(fn, ms);
  };
  const desligar = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const aoMudar = () => {
    if (document.hidden) desligar();
    else {
      fn();
      ligar();
    }
  };
  if (!document.hidden) ligar();
  document.addEventListener('visibilitychange', aoMudar);
  return () => {
    desligar();
    document.removeEventListener('visibilitychange', aoMudar);
  };
}

export const ESTADO_EXECUCAO: Record<string, string> = {
  rodando: 'rodando agora',
  aguardando_resposta: 'esperando resposta',
  aguardando_tempo: 'esperando',
  concluida: 'concluída',
  cancelada: 'cancelada',
  erro: 'com erro',
};

export const EXECUCAO_ATIVA = new Set(['rodando', 'aguardando_resposta', 'aguardando_tempo']);
