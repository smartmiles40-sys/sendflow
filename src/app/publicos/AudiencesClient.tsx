'use client';

import { useMemo, useState } from 'react';
import type { Audience, Group } from '@/lib/types';

function audienceMeta(a: Audience): { icon: string; count: string } {
  if (a.tipo === 'todos') return { icon: '🌐', count: 'todos os grupos ativos' };
  const n = a.group_ids?.length ?? 0;
  return { icon: '⭐', count: `${n} ${n === 1 ? 'grupo' : 'grupos'}` };
}

export function AudiencesClient({
  initial,
  groups,
}: {
  initial: Audience[];
  groups: Group[];
}) {
  const [auds, setAuds] = useState(initial);
  const [nome, setNome] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.nome.toLowerCase().includes(q) || g.group_id.toLowerCase().includes(q),
    );
  }, [groups, query]);

  const tipoLabel = selected.length ? 'manual' : 'todos';

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/audiences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, tipo: tipoLabel, group_ids: selected }),
      });
      if (res.ok) {
        const a = (await res.json()) as Audience;
        setAuds([a, ...auds]);
        setNome('');
        setSelected([]);
        setQuery('');
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Não foi possível salvar o público.');
      }
    } catch {
      setError('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Públicos</h1>
        <p className="mt-1.5 text-sm text-muted">
          Conjuntos de grupos que você reutiliza nas campanhas. Sem nenhum público, os disparos vão
          para todos os grupos ativos.
        </p>
      </header>

      {/* Saved públicos */}
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        Públicos salvos
      </div>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[13px] border border-blue bg-blue/10 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">🌐 Todos os grupos ativos</div>
          <div className="mt-1.5 text-[12.5px] text-muted">padrão · usado quando nenhum é escolhido</div>
        </div>
        {auds.map((a) => {
          const m = audienceMeta(a);
          return (
            <div
              key={a.id}
              className="rounded-[13px] border border-border bg-surface2 p-4 transition-colors hover:border-blue2/50"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span aria-hidden="true">{m.icon}</span>
                <span className="truncate">{a.nome}</span>
              </div>
              <div className="mt-1.5 text-[12.5px] text-muted">{m.count}</div>
            </div>
          );
        })}
      </div>

      {/* Create new público */}
      <div className="rounded-xl2 border border-border bg-surface p-[22px]">
        <div className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          Novo público salvo
        </div>

        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome do público (ex.: Grupos VIP)"
          className="mb-3.5 w-full rounded-xl border border-border bg-surface2 px-[13px] py-3 text-sm text-ink outline-none placeholder:text-muted focus:border-blue2"
        />

        <div className="mb-3 text-[13px] text-muted">
          Escolha os grupos — <b className="text-ink">nenhum marcado = todos os ativos</b>.
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔎 Buscar grupo pelo nome…"
          className="mb-3.5 w-full rounded-xl border border-border bg-surface2 px-[13px] py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-blue2"
        />

        <div className="mb-4 max-h-64 overflow-auto rounded-xl border border-border">
          {groups.length === 0 ? (
            <div className="px-3.5 py-6 text-sm text-muted">
              Nenhum grupo ativo. Cadastre grupos primeiro na aba Grupos.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3.5 py-6 text-sm text-muted">Nenhum grupo encontrado para “{query}”.</div>
          ) : (
            filtered.map((g) => {
              const on = selected.includes(g.group_id);
              return (
                <label
                  key={g.id}
                  className="flex cursor-pointer items-center gap-3 border-t border-border px-3.5 py-3 first:border-t-0 hover:bg-white/[0.02]"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(g.group_id)}
                    className="sr-only"
                  />
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs text-on-blue transition-colors ${
                      on ? 'border-blue bg-blue' : 'border-[#2A6166]'
                    }`}
                    aria-hidden="true"
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{g.nome}</span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-muted">
                      {g.group_id}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 rounded-full border border-green/30 px-2 py-0.5 text-[11px] text-green">
                    ativo
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-muted">
            {selected.length ? (
              <>
                <b className="text-ink">{selected.length}</b>{' '}
                {selected.length === 1 ? 'grupo selecionado' : 'grupos selecionados'} · salva como{' '}
                <b className="text-ink">manual</b>
              </>
            ) : (
              <>
                Nenhum grupo marcado · salva como <b className="text-ink">todos os ativos</b>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving || !nome.trim()}
            className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? 'Salvando…' : '💾 Salvar público'}
          </button>
        </div>

        {error && (
          <p className="mt-3 text-sm text-[#ffb183]" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
