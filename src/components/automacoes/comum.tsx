'use client';

// Peças compartilhadas pelas abas da tela Automações.

import { useState } from 'react';
import type { Fluxo, Gatilho } from '@/lib/automacao/tipos';

/** Gatilho como a API devolve: com o nome e o status do fluxo junto. */
export type GatilhoLinha = Gatilho & { fluxos?: { nome: string; status: string } | null };

export type FluxoResumo = Omit<Fluxo, 'grafo'>;

export interface DadosAutomacoes {
  fluxos: FluxoResumo[];
  gatilhos: GatilhoLinha[];
}

/** O que toda aba que mexe em gatilho recebe. */
export interface PropsAba {
  dados: DadosAutomacoes;
  recarregar: () => Promise<void>;
}

export interface ConexaoOficial {
  id: string;
  nome: string;
  numero: string | null;
  status: string;
}

/** fetch + JSON + erro em português. Lança com a frase da API. */
export async function api<T = Record<string, unknown>>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  }).catch(() => null);
  if (!res) throw new ErroApi('Sem conexão com o servidor.');
  const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ErroApi(
      String(corpo.error ?? 'Não foi possível concluir.'),
      Array.isArray(corpo.problemas) ? (corpo.problemas as ProblemaApi[]) : [],
    );
  }
  return corpo as T;
}

export interface ProblemaApi {
  noId: string | null;
  mensagem: string;
  grave: boolean;
}

export class ErroApi extends Error {
  problemas: ProblemaApi[];
  constructor(msg: string, problemas: ProblemaApi[] = []) {
    super(msg);
    this.problemas = problemas;
  }
}

export const btnPrimario =
  'rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted';
export const btnSecundario =
  'rounded-xl border border-border px-4 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-blue2 hover:bg-white/5 disabled:cursor-not-allowed disabled:text-muted';
export const btnPequeno =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60';

export function Cartao({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl2 border border-border bg-surface p-4 sm:p-[20px] ${className}`}>{children}</div>;
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl2 border border-dashed border-border bg-surface/60 p-6 text-sm leading-relaxed text-muted">
      {children}
    </div>
  );
}

export function Aviso({ children, tom = 'erro' }: { children: React.ReactNode; tom?: 'erro' | 'ok' | 'info' }) {
  const cls =
    tom === 'erro'
      ? 'border-orange/30 bg-orange/[0.08] text-[#ffb183]'
      : tom === 'ok'
        ? 'border-green/30 bg-green/[0.08] text-[#bfeec9]'
        : 'border-blue2/25 bg-blue2/[0.06] text-[#DFEFC5]';
  return (
    <div role={tom === 'erro' ? 'alert' : 'status'} className={`rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}

const ESTILO_STATUS: Record<string, { label: string; cls: string }> = {
  ativo: { label: 'Ativo', cls: 'border-green/30 bg-green/10 text-[#bfeec9]' },
  rascunho: { label: 'Rascunho', cls: 'border-border bg-surface2 text-muted' },
  pausado: { label: 'Pausado', cls: 'border-orange/30 bg-orange/10 text-[#ffb183]' },
};

export function ChipStatus({ status }: { status: string }) {
  const e = ESTILO_STATUS[status] ?? ESTILO_STATUS.rascunho;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${e.cls}`}>
      {status === 'ativo' && <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden="true" />}
      {e.label}
    </span>
  );
}

export function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center truncate rounded-full border border-blue2/25 bg-blue2/10 px-2.5 py-0.5 text-[11.5px] font-medium text-[#DFEFC5]"
    >
      {children}
    </span>
  );
}

/** Botão de copiar com retorno "Copiado ✓" — a pessoa precisa saber que funcionou. */
export function Copiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(texto)
          .then(() => {
            setOk(true);
            setTimeout(() => setOk(false), 1600);
          })
          .catch(() => undefined);
      }}
      className={btnPequeno}
    >
      {ok ? 'Copiado ✓' : rotulo}
    </button>
  );
}

/** Linha de código com botão de copiar ao lado. */
export function CampoCopiavel({ valor }: { valor: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-[12px] text-[#C9DCD8]" title={valor}>
        {valor}
      </code>
      <Copiar texto={valor} />
    </div>
  );
}

/**
 * "Apagar" que pede confirmação no próprio botão. Nada de janela do navegador: ela
 * trava a aba e, no celular, some atrás do teclado.
 */
export function ApagarInline({ onConfirmar, rotulo = 'Apagar' }: { onConfirmar: () => Promise<void> | void; rotulo?: string }) {
  const [pedindo, setPedindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  if (!pedindo) {
    return (
      <button type="button" onClick={() => setPedindo(true)} className={btnPequeno}>
        {rotulo}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-[#ffb183]">Certeza?</span>
      <button
        type="button"
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          try {
            await onConfirmar();
          } finally {
            setOcupado(false);
            setPedindo(false);
          }
        }}
        className="rounded-lg border border-orange/40 bg-orange/15 px-2.5 py-1.5 text-xs font-semibold text-[#ffb183] hover:bg-orange/25"
      >
        {ocupado ? '…' : 'Sim, apagar'}
      </button>
      <button type="button" onClick={() => setPedindo(false)} className={btnPequeno}>
        Não
      </button>
    </span>
  );
}

/** Select de fluxo: todos, com o status ao lado para ninguém ligar gatilho em rascunho sem saber. */
export function SeletorFluxo({
  fluxos,
  valor,
  onChange,
  id,
}: {
  fluxos: FluxoResumo[];
  valor: string;
  onChange: (id: string) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-border bg-surface2 px-[13px] py-3 text-sm text-ink outline-none focus:border-blue2"
    >
      <option value="">Escolha um fluxo…</option>
      {fluxos.map((f) => (
        <option key={f.id} value={f.id}>
          {f.nome}
          {f.status !== 'ativo' ? ` (${f.status})` : ''}
        </option>
      ))}
    </select>
  );
}

/** Aviso quando o gatilho aponta para um fluxo que não está ativo — ele não vai disparar. */
export function AvisoFluxoInativo({ g }: { g: GatilhoLinha }) {
  if (!g.fluxos || g.fluxos.status === 'ativo') return null;
  return (
    <p className="mt-1 text-[11.5px] text-[#ffb183]">
      O fluxo está {g.fluxos.status === 'pausado' ? 'pausado' : 'em rascunho'} — este gatilho só dispara depois de ativar o fluxo.
    </p>
  );
}

export const selectCls =
  'w-full rounded-xl border border-border bg-surface2 px-[13px] py-3 text-sm text-ink outline-none focus:border-blue2';

/** "há 3 min", "ontem" — para a lista de fluxos. */
export function haQuanto(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}
