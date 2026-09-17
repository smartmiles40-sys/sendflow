'use client';

import Link from 'next/link';
import { categoriaLabel, type CategoriaKey } from '@/lib/categories';

export type SequenceListItem = {
  id: string;
  nome: string;
  categoria: CategoriaKey;
  stepCount: number;
};

export function SequencesListClient({
  items,
  loadError,
  tableMissing,
}: {
  items: SequenceListItem[];
  loadError: string | null;
  tableMissing: boolean;
}) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Sequências</h1>
        <p className="mt-1.5 text-sm text-muted">
          Roteiros reutilizáveis: preencha tema, data e hora e a plataforma agenda a semana inteira.
        </p>
      </div>

      {tableMissing && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]"
        >
          <span aria-hidden="true">⚠️</span>
          <span className="flex-1">
            A tabela <code className="font-mono">sequences</code> ainda não existe no banco. Rode a
            migration <code className="font-mono">0004_sequences.sql</code> para liberar esta tela.
          </span>
        </div>
      )}

      {loadError && !tableMissing && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]"
        >
          <span aria-hidden="true">⚠️</span>
          <span className="flex-1">Não foi possível carregar os roteiros: {loadError}</span>
        </div>
      )}

      {items.length === 0 && !loadError ? (
        <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
          Nenhum roteiro cadastrado ainda.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <div
              key={s.id}
              className="flex flex-col rounded-xl2 border border-border bg-surface p-[18px]"
            >
              <div className="mb-1 flex items-start gap-2">
                <h2 className="min-w-0 flex-1 font-display text-lg font-semibold leading-tight">
                  {s.nome}
                </h2>
                <span className="shrink-0 rounded-full border border-blue2/30 bg-blue2/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#DFEFC5]">
                  {categoriaLabel(s.categoria)}
                </span>
              </div>
              <p className="mb-4 text-[13px] text-muted">
                {s.stepCount} {s.stepCount === 1 ? 'mensagem' : 'mensagens'} no roteiro
              </p>

              <div className="mt-auto flex flex-wrap gap-2.5">
                <Link
                  href={`/sequencias/${s.id}/editar`}
                  className="flex-1 rounded-xl border border-border px-3 py-2.5 text-center text-[13px] font-semibold text-ink transition-colors hover:bg-white/5"
                >
                  ✏️ Editar roteiro
                </Link>
                <Link
                  href={`/sequencias/${s.id}/disparar`}
                  className="flex-1 rounded-xl bg-blue px-3 py-2.5 text-center text-[13px] font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover"
                >
                  📅 Disparar semana
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
