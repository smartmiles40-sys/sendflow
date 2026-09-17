'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Recorrencia } from '@/lib/types';
import { categoriaLabel } from '@/lib/categories';
import { describeRecorrencia } from '@/lib/recurrence';
import { formatWhen } from '@/lib/format';
import { Switch } from '@/components/ui';

export interface RecorrenciaItem extends Recorrencia {
  /** Público em texto ("Todos os grupos ativos", nome do público salvo, "3 grupos"). */
  publicoLabel: string;
  /** Próximas ocorrências já agendadas (ISO), no máximo 3. */
  proximas: string[];
}

export function RecorrenciasClient({
  initial,
  loadError,
  tableMissing,
}: {
  initial: RecorrenciaItem[];
  loadError: string | null;
  tableMissing: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});

  async function toggleAtivo(r: RecorrenciaItem) {
    setRowBusy((b) => ({ ...b, [r.id]: true }));
    setRowError((e) => ({ ...e, [r.id]: null }));
    try {
      const res = await fetch(`/api/recorrencias/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !r.ativo }),
      });
      if (res.ok) {
        setItems((xs) => xs.map((x) => (x.id === r.id ? { ...x, ativo: !r.ativo } : x)));
        // As ocorrências futuras mudaram (canceladas ou recriadas): recarrega as datas.
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setRowError((e) => ({
          ...e,
          [r.id]: body.error ?? 'Não foi possível atualizar a recorrência.',
        }));
      }
    } catch {
      setRowError((e) => ({ ...e, [r.id]: 'Sem conexão com o servidor. Tente de novo.' }));
    } finally {
      setRowBusy((b) => ({ ...b, [r.id]: false }));
    }
  }

  async function remove(r: RecorrenciaItem) {
    if (
      !window.confirm(
        `Excluir a recorrência "${r.nome}"? As ocorrências futuras ainda não enviadas serão canceladas.`,
      )
    ) {
      return;
    }
    setRowBusy((b) => ({ ...b, [r.id]: true }));
    setRowError((e) => ({ ...e, [r.id]: null }));
    try {
      const res = await fetch(`/api/recorrencias/${r.id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems((xs) => xs.filter((x) => x.id !== r.id));
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setRowError((e) => ({
          ...e,
          [r.id]: body.error ?? 'Não foi possível excluir a recorrência.',
        }));
        setRowBusy((b) => ({ ...b, [r.id]: false }));
      }
    } catch {
      setRowError((e) => ({ ...e, [r.id]: 'Sem conexão com o servidor. Tente de novo.' }));
      setRowBusy((b) => ({ ...b, [r.id]: false }));
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Recorrentes</h1>
          <p className="mt-1.5 text-sm text-muted">
            Mensagens que se repetem toda semana num dia fixo. Ligue uma vez — a plataforma agenda
            as próximas 6 semanas e vai repondo sozinha.
          </p>
        </div>
        <Link
          href="/recorrencias/nova"
          className="rounded-xl bg-blue px-4 py-2.5 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(1,71,255,.35)] transition-colors hover:bg-[#0a54ff]"
        >
          + Nova recorrência
        </Link>
      </div>

      {tableMissing && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]"
        >
          <span aria-hidden="true">⚠️</span>
          <span className="flex-1">
            A tabela <code className="font-mono">recorrencias</code> ainda não existe no banco. Rode
            a migration <code className="font-mono">0005_recorrencias.sql</code> para liberar esta
            tela.
          </span>
        </div>
      )}

      {loadError && !tableMissing && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]"
        >
          <span aria-hidden="true">⚠️</span>
          <span className="flex-1">Não foi possível carregar as recorrências: {loadError}</span>
        </div>
      )}

      {items.length === 0 && !loadError ? (
        <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
          Nenhuma recorrência ainda. Crie uma para, por exemplo, mandar a mensagem da comunidade toda
          segunda de manhã.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((r) => (
            <div
              key={r.id}
              className={`flex flex-col rounded-xl2 border border-border bg-surface p-[18px] ${
                r.ativo ? '' : 'opacity-60'
              }`}
            >
              <div className="mb-1 flex items-start gap-2">
                <h2 className="min-w-0 flex-1 font-display text-lg font-semibold leading-tight">
                  {r.nome}
                </h2>
                <span className="shrink-0 rounded-full border border-blue2/30 bg-blue2/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#9cc0ff]">
                  {categoriaLabel(r.categoria)}
                </span>
              </div>

              <p className="text-[13px] font-semibold text-ink">
                {describeRecorrencia(r.dia_semana, r.hora)}
              </p>
              <p className="mb-3 text-[13px] text-muted">{r.publicoLabel}</p>

              <div className="mb-4 rounded-xl border border-border bg-surface2 px-3 py-2.5 text-[12.5px] text-muted">
                {r.ativo ? (
                  r.proximas.length ? (
                    <>
                      <span className="font-semibold text-[#b9c6e6]">Próximos envios:</span>{' '}
                      {r.proximas.map((p) => formatWhen(p)).join(' · ')}
                    </>
                  ) : (
                    'Nenhuma ocorrência agendada ainda.'
                  )
                ) : (
                  'Pausada — nada agendado.'
                )}
              </div>

              {rowError[r.id] && (
                <p className="mb-3 text-xs text-[#ffb183]" role="alert">
                  {rowError[r.id]}
                </p>
              )}

              <div className="mt-auto flex items-center gap-2.5">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                  <Switch
                    checked={r.ativo}
                    onChange={() => void toggleAtivo(r)}
                    label={`Ativar ${r.nome}`}
                  />
                  {r.ativo ? 'Ativa' : 'Pausada'}
                </label>
                <Link
                  href={`/recorrencias/${r.id}/editar`}
                  className="ml-auto rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-white/5"
                >
                  Editar
                </Link>
                <button
                  type="button"
                  onClick={() => void remove(r)}
                  disabled={rowBusy[r.id]}
                  className="rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted transition-colors hover:border-orange/40 hover:text-[#ffb183] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
