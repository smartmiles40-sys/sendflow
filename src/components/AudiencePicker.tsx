'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Audience, Group, GroupTag } from '@/lib/types';
import { gruposDaTag, ordenarTags } from '@/lib/tags';
import { Field, SegButton, inputCls } from './ui';
import { TagChip } from './TagChip';

export type AudienceMode = 'todos' | 'salvo' | 'grupos';

// Fallback for the estimate/summary copy when the real active-group count isn't
// known yet (fetch pending/failed). The n8n dispatcher uses the true count at send time.
export const GROUP_COUNT_HINT = 18;

// Resolve the picker's UI state into the API's { audience_id, group_ids } shape.
export function resolveAudience(
  mode: AudienceMode,
  selectedAudienceId: string | null,
  selectedGroupIds: string[],
): { audience_id: string | null; group_ids: string[] | null } {
  if (mode === 'salvo') return { audience_id: selectedAudienceId, group_ids: null };
  if (mode === 'grupos') {
    return { audience_id: null, group_ids: selectedGroupIds.length ? selectedGroupIds : null };
  }
  return { audience_id: null, group_ids: null };
}

export function AudiencePicker({
  audiences,
  groups,
  mode,
  onModeChange,
  selectedAudienceId,
  onSelectAudience,
  selectedGroupIds,
  onToggleGroup,
  groupQuery,
  onGroupQueryChange,
  error,
  onClearError,
  semTodos = false,
  onSetGroups,
}: {
  audiences: Audience[];
  groups: Group[];
  mode: AudienceMode;
  onModeChange: (m: AudienceMode) => void;
  selectedAudienceId: string | null;
  onSelectAudience: (id: string | null) => void;
  selectedGroupIds: string[];
  onToggleGroup: (groupId: string) => void;
  groupQuery: string;
  onGroupQueryChange: (q: string) => void;
  error?: string;
  onClearError?: () => void;
  /**
   * Esconde o "Todos os grupos". Usado na cadência, onde destino vazio NÃO pode virar
   * "a base inteira": cada passo esquecido seria um disparo para todos os grupos.
   */
  semTodos?: boolean;
  /** Troca a seleção inteira de uma vez (usado pelo "marcar por tag"). */
  onSetGroups?: (groupIds: string[]) => void;
}) {
  const activeGroups = useMemo(() => groups.filter((g) => g.ativo), [groups]);

  // Tags: atalho para marcar de uma vez todos os grupos ativos de uma live/turma.
  const [tags, setTags] = useState<GroupTag[]>([]);
  useEffect(() => {
    let vivo = true;
    fetch('/api/tags')
      .then((r) => (r.ok ? r.json() : []))
      .then((t: GroupTag[]) => {
        if (vivo) setTags(ordenarTags(Array.isArray(t) ? t : []));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  const tagsUsadas = useMemo(
    () => tags.filter((t) => gruposDaTag(groups, t.id).length > 0),
    [tags, groups],
  );

  /** Marca todos os grupos ativos da tag; se já estavam todos marcados, desmarca. */
  function alternarTag(tagId: string) {
    const daTag = gruposDaTag(groups, tagId);
    const todos = daTag.every((id) => selectedGroupIds.includes(id));
    if (onSetGroups) {
      onSetGroups(
        todos
          ? selectedGroupIds.filter((id) => !daTag.includes(id))
          : [...new Set([...selectedGroupIds, ...daTag])],
      );
    } else {
      // Só é seguro em pai que usa setState funcional (senão só o último toque vale).
      for (const id of daTag) {
        if (todos || !selectedGroupIds.includes(id)) onToggleGroup(id);
      }
    }
    onClearError?.();
  }
  const activeCount = activeGroups.length || GROUP_COUNT_HINT;

  function audienceGroupCount(a: Audience): number {
    return a.tipo === 'manual' ? (a.group_ids?.length ?? 0) : activeCount;
  }

  const selectedAudience = useMemo(
    () => audiences.find((a) => a.id === selectedAudienceId) ?? null,
    [audiences, selectedAudienceId],
  );

  const filteredGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.nome.toLowerCase().includes(q) || g.group_id.toLowerCase().includes(q),
    );
  }, [groups, groupQuery]);

  return (
    <Field label="Público" error={error}>
      <div className="mb-3 flex flex-wrap gap-2">
        {!semTodos && (
          <SegButton
            on={mode === 'todos'}
            onClick={() => {
              onModeChange('todos');
              onClearError?.();
            }}
          >
            🌐 Todos os grupos
          </SegButton>
        )}
        <SegButton on={mode === 'salvo'} onClick={() => onModeChange('salvo')}>
          ⭐ Público salvo
        </SegButton>
        <SegButton
          on={mode === 'grupos'}
          onClick={() => {
            onModeChange('grupos');
            onClearError?.();
          }}
        >
          ✅ Grupos específicos
        </SegButton>
      </div>

      {mode === 'todos' && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface2 px-3.5 py-[13px]">
          <span className="font-display text-xl font-semibold leading-none">🌐</span>
          <div className="text-sm">
            <div className="font-semibold">Todos os grupos ativos</div>
            <div className="text-xs text-muted">
              {activeGroups.length ? `${activeCount} grupos` : 'definido no envio'} · da aba “Grupos”
            </div>
          </div>
          <Link
            href="/publicos"
            className="ml-auto shrink-0 text-[13px] font-semibold text-blue2 transition-colors hover:text-ink"
          >
            Gerenciar ›
          </Link>
        </div>
      )}

      {mode === 'salvo' && (
        <div>
          {audiences.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface2 px-3.5 py-3 text-[13px] text-muted">
              Nenhum público salvo ainda.{' '}
              <Link href="/publicos" className="font-semibold text-blue2 hover:text-ink">
                Criar um público ›
              </Link>
            </div>
          ) : (
            <>
              <select
                aria-label="Público salvo"
                value={selectedAudienceId ?? ''}
                onChange={(e) => {
                  onSelectAudience(e.target.value || null);
                  onClearError?.();
                }}
                className={`${inputCls} [color-scheme:dark] cursor-pointer`}
              >
                <option value="">Escolha um público…</option>
                {audiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome} · {audienceGroupCount(a)} grupos
                  </option>
                ))}
              </select>
              {selectedAudience && (
                <div className="mt-2 text-[13px] text-muted">
                  Público: <b className="text-ink">{selectedAudience.nome}</b> (
                  {audienceGroupCount(selectedAudience)})
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'grupos' && (
        <div>
          <input
            aria-label="Buscar grupo pelo nome ou ID"
            value={groupQuery}
            onChange={(e) => onGroupQueryChange(e.target.value)}
            placeholder="🔎 Buscar grupo pelo nome ou ID…"
            className={`${inputCls} mb-3 py-2.5`}
          />
          {tagsUsadas.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-xs text-muted">Marcar por tag:</div>
              <div className="flex flex-wrap gap-1.5">
                {tagsUsadas.map((t) => {
                  const daTag = gruposDaTag(groups, t.id);
                  return (
                    <TagChip
                      key={t.id}
                      tag={t}
                      contagem={daTag.length}
                      ativo={daTag.every((id) => selectedGroupIds.includes(id))}
                      onClick={() => alternarTag(t.id)}
                      titulo={`Marca os ${daTag.length} grupos ativos com esta tag`}
                    />
                  );
                })}
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-auto rounded-xl border border-border">
            {groups.length === 0 ? (
              <div className="px-3.5 py-6 text-sm text-muted">
                Nenhum grupo cadastrado. Adicione grupos primeiro na aba Grupos.
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="px-3.5 py-6 text-sm text-muted">
                Nenhum grupo encontrado para “{groupQuery}”.
              </div>
            ) : (
              filteredGroups.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  checked={selectedGroupIds.includes(g.group_id)}
                  onToggle={() => onToggleGroup(g.group_id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Summary line */}
      <div className="mt-2.5 text-[13px] text-muted">
        {mode === 'todos' &&
          (activeGroups.length ? (
            <>
              <b className="text-ink">{activeCount} grupos</b> · todos os ativos
            </>
          ) : (
            <>
              <b className="text-ink">Todos os grupos ativos</b> · definido no envio
            </>
          ))}
        {mode === 'salvo' &&
          (selectedAudience ? (
            <>
              Público: <b className="text-ink">{selectedAudience.nome}</b> (
              {audienceGroupCount(selectedAudience)})
            </>
          ) : (
            <>Nenhum público escolhido</>
          ))}
        {mode === 'grupos' &&
          (selectedGroupIds.length ? (
            <>
              <b className="text-ink">{selectedGroupIds.length}</b>{' '}
              {selectedGroupIds.length === 1 ? 'grupo selecionado' : 'grupos selecionados'}
            </>
          ) : (
            <>{semTodos ? 'Nenhum grupo marcado' : 'Nenhum grupo marcado · envia para todos os ativos'}</>
          ))}
      </div>
    </Field>
  );
}

function GroupRow({
  group,
  checked,
  onToggle,
}: {
  group: Group;
  checked: boolean;
  onToggle: () => void;
}) {
  const selectable = group.ativo;
  const Wrapper = selectable ? 'label' : 'div';
  return (
    <Wrapper
      className={`flex items-center gap-3 border-t border-border px-3.5 py-3 first:border-t-0 ${
        selectable ? 'cursor-pointer hover:bg-white/[0.02]' : 'cursor-not-allowed opacity-60'
      }`}
    >
      {selectable && (
        <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
      )}
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs text-on-blue transition-colors ${
          checked ? 'border-blue bg-blue' : 'border-[#2A6166]'
        }`}
        aria-hidden="true"
      >
        {checked ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${selectable ? '' : 'text-muted'}`}>
          {group.nome}
        </span>
        <span className="mt-0.5 block truncate font-mono text-xs text-muted">{group.group_id}</span>
      </span>
      {selectable ? (
        <span className="ml-auto shrink-0 rounded-full border border-green/30 px-2 py-0.5 text-[11px] text-green">
          ativo
        </span>
      ) : (
        <span className="ml-auto shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
          inativo
        </span>
      )}
    </Wrapper>
  );
}
