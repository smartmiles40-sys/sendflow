'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Group } from '@/lib/types';

const inputCls =
  'w-full rounded-xl border border-border bg-surface2 px-3 py-3 text-sm text-ink outline-none placeholder:text-muted focus:border-blue2';

export function GroupsClient({ initial }: { initial: Group[] }) {
  const [groups, setGroups] = useState(initial);
  const [groupId, setGroupId] = useState('');
  const [nome, setNome] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row in-flight state and inline errors, keyed by group id, so one row's
  // toggle/delete doesn't disable or fail silently for the rest of the list.
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});

  async function toggleAtivo(g: Group) {
    setRowBusy((b) => ({ ...b, [g.id]: true }));
    setRowError((e) => ({ ...e, [g.id]: null }));
    try {
      const res = await fetch(`/api/groups/${g.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !g.ativo }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Group;
        setGroups((gs) => gs.map((x) => (x.id === g.id ? updated : x)));
      } else {
        const body = await res.json().catch(() => ({}));
        setRowError((e) => ({ ...e, [g.id]: body.error ?? 'Não foi possível atualizar o grupo.' }));
      }
    } catch {
      setRowError((e) => ({ ...e, [g.id]: 'Sem conexão com o servidor. Tente de novo.' }));
    } finally {
      setRowBusy((b) => ({ ...b, [g.id]: false }));
    }
  }

  async function removeGroup(g: Group) {
    if (!window.confirm(`Excluir o grupo "${g.nome}"? Essa ação não pode ser desfeita.`)) return;
    setRowBusy((b) => ({ ...b, [g.id]: true }));
    setRowError((e) => ({ ...e, [g.id]: null }));
    try {
      const res = await fetch(`/api/groups/${g.id}`, { method: 'DELETE' });
      if (res.ok) {
        setGroups((gs) => gs.filter((x) => x.id !== g.id));
      } else {
        const body = await res.json().catch(() => ({}));
        setRowError((e) => ({ ...e, [g.id]: body.error ?? 'Não foi possível excluir o grupo.' }));
        setRowBusy((b) => ({ ...b, [g.id]: false }));
      }
    } catch {
      setRowError((e) => ({ ...e, [g.id]: 'Sem conexão com o servidor. Tente de novo.' }));
      setRowBusy((b) => ({ ...b, [g.id]: false }));
    }
  }

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId, nome }),
      });
      if (res.ok) {
        const g = (await res.json()) as Group;
        setGroups([g, ...groups]);
        setGroupId('');
        setNome('');
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Não foi possível salvar o grupo.');
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
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em]">Grupos</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          Os grupos vêm do próprio WhatsApp: conecte um número em{' '}
          <Link href="/conexoes" className="font-semibold text-blue2 hover:underline">
            Conexões
          </Link>{' '}
          e clique em <b>Puxar grupos</b>. Eles chegam desativados — você liga um a um os que
          devem receber campanha.
        </p>
      </header>

      <details className="mb-6 rounded-xl2 border border-border bg-surface p-5">
        <summary className="cursor-pointer text-sm font-semibold text-muted transition-colors hover:text-ink">
          Cadastrar um grupo à mão
        </summary>
        <p className="mt-2 mb-4 text-xs leading-relaxed text-muted">
          Só é preciso quando o grupo ainda não apareceu na sincronização. O caminho normal é
          puxar os grupos pela conexão.
        </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1 text-sm">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            ID do grupo
          </span>
          <input
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            placeholder="120363…-group"
            className={inputCls}
          />
        </label>
        <label className="min-w-[220px] flex-1 text-sm">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Nome amigável
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Clientes Turma 12"
            className={inputCls}
          />
        </label>
        <button
          onClick={add}
          disabled={saving || !groupId.trim() || !nome.trim()}
          className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {saving ? 'Salvando…' : '＋ Adicionar'}
        </button>

        {error && (
          <p className="w-full text-sm text-[#ffb183]" role="alert">
            {error}
          </p>
        )}
      </div>
      </details>

      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {groups.length === 0 ? (
          <div className="p-6 text-sm leading-relaxed text-muted">
            Nenhum grupo ainda.{' '}
            <Link href="/conexoes" className="font-semibold text-blue2 hover:underline">
              Conecte um número
            </Link>{' '}
            e clique em <b>Puxar grupos</b> — eles aparecem aqui sozinhos.
          </div>
        ) : (
          groups.map((g) => {
            const busy = Boolean(rowBusy[g.id]);
            const rowErr = rowError[g.id];
            return (
              <div
                key={g.id}
                className="flex items-center gap-3 border-t border-border px-4 py-3.5 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{g.nome}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    {typeof g.participantes === 'number' && <span>{g.participantes} participantes</span>}
                    <span className="truncate font-mono">{g.group_id}</span>
                  </div>
                  {rowErr && (
                    <p className="mt-1 text-xs text-[#ffb183]" role="alert">
                      {rowErr}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    g.ativo ? 'border-green/30 text-green' : 'border-border text-muted'
                  }`}
                >
                  {g.ativo ? 'ativo' : 'inativo'}
                </span>
                <Switch
                  checked={g.ativo}
                  disabled={busy}
                  onChange={() => void toggleAtivo(g)}
                  label={g.ativo ? `Desativar ${g.nome}` : `Ativar ${g.nome}`}
                />
                <button
                  type="button"
                  onClick={() => void removeGroup(g)}
                  disabled={busy}
                  aria-label={`Excluir ${g.nome}`}
                  title="Excluir grupo"
                  className="shrink-0 rounded-lg border border-border p-2 text-sm text-muted transition-colors hover:border-[#ffb183]/40 hover:text-[#ffb183] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  🗑
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Matches the on-brand toggle used for "Mencionar todos" in the campaign composer
// (src/app/campanhas/nova/page.tsx), plus a disabled state for in-flight requests.
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-[42px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-blue' : 'bg-[#1F555A]'
      }`}
    >
      <span
        className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all ${
          checked ? 'left-[21px]' : 'left-[3px]'
        }`}
      />
    </button>
  );
}
