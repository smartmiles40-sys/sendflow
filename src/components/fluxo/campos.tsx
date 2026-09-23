'use client';

// Peças de formulário dos editores de bloco: texto com contador e "chips" de variável,
// rótulos, botões pequenos. Tudo no mesmo visual do resto do painel (ui.tsx).

import { useRef } from 'react';
import { inputCls } from '@/components/ui';

export const labelCls = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted';
export const miniBtn =
  'rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40';
export const perigoBtn =
  'rounded-lg px-2 py-1 text-xs font-semibold text-muted transition-colors hover:bg-orange/10 hover:text-[#ffb183]';

export const VARIAVEIS_BASE = [
  { chave: 'primeiro_nome', rotulo: 'Primeiro nome' },
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'email', rotulo: 'E-mail' },
  { chave: 'telefone', rotulo: 'Telefone' },
];

export function Contador({ valor, max }: { valor: string; max: number }) {
  const n = valor.length;
  const cls = n > max ? 'text-[#ffb183] font-semibold' : n > max * 0.9 ? 'text-[#fab219]' : 'text-muted/70';
  return (
    <span className={`text-[11px] tabular-nums ${cls}`} aria-live="polite">
      {n}/{max}
    </span>
  );
}

/**
 * Campo de texto com contador ao vivo e botões que inserem `{{variavel}}` onde o
 * cursor está — é assim que o ManyChat ensina personalização sem ninguém decorar sintaxe.
 */
export function TextoVar({
  valor,
  onChange,
  max,
  rotulo,
  placeholder,
  linhas = 3,
  variaveis,
  dica,
  semVariaveis,
}: {
  valor: string;
  onChange: (v: string) => void;
  max: number;
  rotulo?: string;
  placeholder?: string;
  /** 1 = input de uma linha. */
  linhas?: number;
  variaveis?: { chave: string; rotulo: string }[];
  dica?: string;
  semVariaveis?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  function inserir(chave: string) {
    const el = ref.current;
    const marcador = `{{${chave}}}`;
    if (!el) return onChange(valor + marcador);
    const ini = el.selectionStart ?? valor.length;
    const fim = el.selectionEnd ?? valor.length;
    const novo = valor.slice(0, ini) + marcador + valor.slice(fim);
    onChange(novo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + marcador.length, ini + marcador.length);
    });
  }

  const todas = [...VARIAVEIS_BASE, ...(variaveis ?? [])];

  return (
    <div className="mb-3">
      {(rotulo || max) && (
        <div className="mb-1.5 flex items-end justify-between gap-2">
          {rotulo ? <span className={labelCls.replace('mb-1.5 ', '')}>{rotulo}</span> : <span />}
          <Contador valor={valor} max={max} />
        </div>
      )}
      {linhas <= 1 ? (
        <input
          ref={ref}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputCls} py-2.5`}
          aria-invalid={valor.length > max}
        />
      ) : (
        <textarea
          ref={ref}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={linhas}
          className={`${inputCls} resize-y leading-relaxed`}
          aria-invalid={valor.length > max}
        />
      )}
      {!semVariaveis && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {todas.map((v) => (
            <button
              key={v.chave}
              type="button"
              onClick={() => inserir(v.chave)}
              title={`Insere {{${v.chave}}}`}
              className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-blue2 hover:text-ink"
            >
              + {v.rotulo}
            </button>
          ))}
        </div>
      )}
      {dica && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{dica}</p>}
    </div>
  );
}

export function Secao({ titulo, children, dica }: { titulo: string; children: React.ReactNode; dica?: string }) {
  return (
    <section className="border-t border-border px-4 py-4 first:border-t-0">
      <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">{titulo}</h3>
      {dica && <p className="mb-3 text-[11px] leading-relaxed text-muted">{dica}</p>}
      {!dica && <div className="mb-2" />}
      {children}
    </section>
  );
}

export function Numero({
  valor,
  onChange,
  min = 0,
  max,
  className = '',
}: {
  valor: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={Number.isFinite(valor) ? valor : 0}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${inputCls} py-2.5 ${className}`}
    />
  );
}

export function Selecao({
  valor,
  onChange,
  children,
  className = '',
  rotulo,
}: {
  valor: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  rotulo?: string;
}) {
  return (
    <select
      aria-label={rotulo}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls} py-2.5 ${className}`}
    >
      {children}
    </select>
  );
}
