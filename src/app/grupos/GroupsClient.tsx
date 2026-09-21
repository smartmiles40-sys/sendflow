'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Group, GroupTag } from '@/lib/types';
import { CORES_DE_TAG, contarPorTag, ordenarTags } from '@/lib/tags';
import { TagChip } from '@/components/TagChip';

const inputCls =
  'w-full rounded-xl border border-border bg-surface2 px-3 py-3 text-sm text-ink outline-none placeholder:text-muted focus:border-blue2';

/** Filtro de tag: uma tag, "sem tag" ou tudo. */
type FiltroTag = { tipo: 'todas' } | { tipo: 'sem' } | { tipo: 'tag'; id: string };

export function GroupsClient({ initial, initialTags }: { initial: Group[]; initialTags: GroupTag[] }) {
  const [groups, setGroups] = useState(initial);
  const [tags, setTags] = useState(() => ordenarTags(initialTags));
  const [groupId, setGroupId] = useState('');
  const [nome, setNome] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row in-flight state and inline errors, keyed by group id, so one row's
  // toggle/delete doesn't disable or fail silently for the rest of the list.
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});

  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroTag>({ tipo: 'todas' });
  const [soAtivos, setSoAtivos] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [editandoTagsDe, setEditandoTagsDe] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const contagem = useMemo(() => contarPorTag(groups), [groups]);
  const tagPorId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return groups.filter((g) => {
      if (soAtivos && !g.ativo) return false;
      const ids = g.tag_ids ?? [];
      if (filtro.tipo === 'sem' && ids.length) return false;
      if (filtro.tipo === 'tag' && !ids.includes(filtro.id)) return false;
      if (q && !g.nome.toLowerCase().includes(q) && !g.group_id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [groups, busca, filtro, soAtivos]);

  const semTag = useMemo(() => groups.filter((g) => !(g.tag_ids ?? []).length).length, [groups]);
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((g) => marcados.has(g.id));

  function trocarGrupo(atualizado: Group) {
    setGroups((gs) => gs.map((x) => (x.id === atualizado.id ? { ...x, ...atualizado } : x)));
  }

  async function patchGroup(g: Group, corpo: Record<string, unknown>, falha: string) {
    setRowBusy((b) => ({ ...b, [g.id]: true }));
    setRowError((e) => ({ ...e, [g.id]: null }));
    try {
      const res = await fetch(`/api/groups/${g.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      if (res.ok) {
        trocarGrupo((await res.json()) as Group);
      } else {
        const body = await res.json().catch(() => ({}));
        setRowError((e) => ({ ...e, [g.id]: body.error ?? falha }));
      }
    } catch {
      setRowError((e) => ({ ...e, [g.id]: 'Sem conexão com o servidor. Tente de novo.' }));
    } finally {
      setRowBusy((b) => ({ ...b, [g.id]: false }));
    }
  }

  function toggleTagDoGrupo(g: Group, tagId: string) {
    const atuais = g.tag_ids ?? [];
    const novas = atuais.includes(tagId) ? atuais.filter((t) => t !== tagId) : [...atuais, tagId];
    // Otimista: a etiqueta muda na hora; se o servidor recusar, o erro aparece na linha.
    trocarGrupo({ ...g, tag_ids: novas });
    void patchGroup(g, { tag_ids: novas }, 'Não foi possível salvar as tags.');
  }

  async function removeGroup(g: Group) {
    if (!window.confirm(`Excluir o grupo "${g.nome}" do SendFlow? O grupo continua existindo no WhatsApp.`)) return;
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

  /** Põe ou tira uma tag de todos os grupos marcados. */
  async function aplicarEmMassa(tagId: string, acao: 'adicionar' | 'remover') {
    const ids = [...marcados];
    if (!ids.length || !tagId) return;
    const tag = tagPorId.get(tagId);
    setAviso(null);
    const res = await fetch('/api/groups/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_ids: ids, tag_id: tagId, acao }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setAviso(body?.error ?? 'Não foi possível aplicar a tag.');
      return;
    }
    setGroups((gs) =>
      gs.map((g) => {
        if (!marcados.has(g.id)) return g;
        const atuais = g.tag_ids ?? [];
        const novas =
          acao === 'adicionar' ? [...new Set([...atuais, tagId])] : atuais.filter((t) => t !== tagId);
        return { ...g, tag_ids: novas };
      }),
    );
    setAviso(
      `${acao === 'adicionar' ? 'Tag' : 'Tag removida:'} “${tag?.nome ?? ''}” ${acao === 'adicionar' ? 'aplicada em' : 'de'} ${ids.length} ${ids.length === 1 ? 'grupo' : 'grupos'}.`,
    );
  }

  function marcar(id: string) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function marcarTodosVisiveis() {
    setMarcados((m) => {
      const n = new Set(m);
      if (todosVisiveisMarcados) visiveis.forEach((g) => n.delete(g.id));
      else visiveis.forEach((g) => n.add(g.id));
      return n;
    });
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-[-0.01em]">Grupos</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          Os grupos vêm do próprio WhatsApp: conecte um número em{' '}
          <Link href="/conexoes" className="font-semibold text-blue2 hover:underline">
            Conexões
          </Link>{' '}
          e clique em <b>Puxar grupos</b>. Eles chegam desativados — você liga um a um os que
          devem receber campanha. Use as <b>tags</b> para separar por live, turma ou expedição.
        </p>
      </header>

      <GerenciarTags
        tags={tags}
        contagem={contagem}
        onMudou={(lista) => setTags(ordenarTags(lista))}
        onApagou={(id) => {
          setGroups((gs) => gs.map((g) => ({ ...g, tag_ids: (g.tag_ids ?? []).filter((t) => t !== id) })));
          if (filtro.tipo === 'tag' && filtro.id === id) setFiltro({ tipo: 'todas' });
        }}
      />

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="🔎 Buscar grupo pelo nome…"
          aria-label="Buscar grupo"
          className={`${inputCls} py-2.5 sm:max-w-xs`}
        />
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={soAtivos} onChange={(e) => setSoAtivos(e.target.checked)} className="accent-[#D7F264]" />
          Só os ativos
        </label>
      </div>
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setFiltro({ tipo: 'todas' })}
          aria-pressed={filtro.tipo === 'todas'}
          className={`shrink-0 rounded-full border px-3 py-1 text-[12.5px] font-medium ${
            filtro.tipo === 'todas' ? 'border-blue bg-blue/15 text-ink' : 'border-border text-muted hover:text-ink'
          }`}
        >
          Todos <span className="opacity-60">{groups.length}</span>
        </button>
        {tags.map((t) => (
          <TagChip
            key={t.id}
            tag={t}
            contagem={contagem[t.id] ?? 0}
            ativo={filtro.tipo === 'tag' && filtro.id === t.id}
            onClick={() =>
              setFiltro(filtro.tipo === 'tag' && filtro.id === t.id ? { tipo: 'todas' } : { tipo: 'tag', id: t.id })
            }
          />
        ))}
        {tags.length > 0 && (
          <button
            type="button"
            onClick={() => setFiltro(filtro.tipo === 'sem' ? { tipo: 'todas' } : { tipo: 'sem' })}
            aria-pressed={filtro.tipo === 'sem'}
            className={`shrink-0 rounded-full border border-dashed px-3 py-1 text-[12.5px] font-medium ${
              filtro.tipo === 'sem' ? 'border-blue text-ink' : 'border-border text-muted hover:text-ink'
            }`}
          >
            Sem tag <span className="opacity-60">{semTag}</span>
          </button>
        )}
      </div>

      {/* Ações em massa */}
      {marcados.size > 0 && (
        <AcoesEmMassa
          quantos={marcados.size}
          tags={tags}
          onAplicar={aplicarEmMassa}
          onLimpar={() => setMarcados(new Set())}
        />
      )}
      {aviso && (
        <p className="mb-3 text-[13px] text-green" role="status">
          {aviso}
        </p>
      )}

      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {groups.length === 0 ? (
          <div className="p-6 text-sm leading-relaxed text-muted">
            Nenhum grupo ainda.{' '}
            <Link href="/conexoes" className="font-semibold text-blue2 hover:underline">
              Conecte um número
            </Link>{' '}
            e clique em <b>Puxar grupos</b> — eles aparecem aqui sozinhos.
          </div>
        ) : visiveis.length === 0 ? (
          <div className="p-6 text-sm text-muted">Nenhum grupo com esse filtro.</div>
        ) : (
          <>
            <label className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={todosVisiveisMarcados}
                onChange={marcarTodosVisiveis}
                className="h-4 w-4 accent-[#D7F264]"
              />
              Marcar os {visiveis.length} da lista
            </label>
            {visiveis.map((g) => {
              const busy = Boolean(rowBusy[g.id]);
              const rowErr = rowError[g.id];
              const tagsDoGrupo = (g.tag_ids ?? []).map((id) => tagPorId.get(id)).filter((t): t is GroupTag => Boolean(t));
              const abertoTags = editandoTagsDe === g.id;
              return (
                <div key={g.id} className="border-t border-border px-4 py-3.5 first:border-t-0">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={marcados.has(g.id)}
                      onChange={() => marcar(g.id)}
                      aria-label={`Marcar ${g.nome}`}
                      className="h-4 w-4 shrink-0 accent-[#D7F264]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{g.nome}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {tagsDoGrupo.map((t) => (
                          <TagChip key={t.id} tag={t} pequeno />
                        ))}
                        {typeof g.participantes === 'number' && <span>{g.participantes} participantes</span>}
                      </div>
                      {rowErr && (
                        <p className="mt-1 text-xs text-[#ffb183]" role="alert">
                          {rowErr}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditandoTagsDe(abertoTags ? null : g.id)}
                      aria-expanded={abertoTags}
                      title="Tags do grupo"
                      className={`shrink-0 rounded-lg border px-2 py-1.5 text-sm transition-colors ${
                        abertoTags ? 'border-blue2 text-ink' : 'border-border text-muted hover:text-ink'
                      }`}
                    >
                      🏷<span className="sr-only">Tags de {g.nome}</span>
                    </button>
                    <Link
                      href={`/celular?jid=${encodeURIComponent(g.group_id)}`}
                      title="Abrir no Celular (conversa e configurações)"
                      className="hidden shrink-0 rounded-lg border border-border px-2 py-1.5 text-sm text-muted transition-colors hover:text-ink sm:inline-block"
                    >
                      💬<span className="sr-only">Abrir {g.nome} no Celular</span>
                    </Link>
                    <Switch
                      checked={g.ativo}
                      disabled={busy}
                      onChange={() => void patchGroup(g, { ativo: !g.ativo }, 'Não foi possível atualizar o grupo.')}
                      label={g.ativo ? `Desativar ${g.nome}` : `Ativar ${g.nome}`}
                    />
                    <button
                      type="button"
                      onClick={() => void removeGroup(g)}
                      disabled={busy}
                      aria-label={`Excluir ${g.nome}`}
                      title="Excluir do SendFlow"
                      className="shrink-0 rounded-lg border border-border p-2 text-sm text-muted transition-colors hover:border-[#ffb183]/40 hover:text-[#ffb183] disabled:cursor-not-allowed disabled:text-[#4d6f6c]"
                    >
                      🗑
                    </button>
                  </div>
                  {abertoTags && (
                    <div className="mt-3 rounded-xl border border-border bg-surface2 p-3 sm:ml-7">
                      {tags.length === 0 ? (
                        <p className="text-xs text-muted">Crie uma tag em “Tags” lá em cima para usar aqui.</p>
                      ) : (
                        <>
                          <p className="mb-2 text-xs text-muted">Toque para pôr ou tirar:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map((t) => (
                              <TagChip
                                key={t.id}
                                tag={t}
                                ativo={(g.tag_ids ?? []).includes(t.id)}
                                onClick={() => toggleTagDoGrupo(g, t.id)}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <details className="mt-6 rounded-xl2 border border-border bg-surface p-5">
        <summary className="cursor-pointer text-sm font-semibold text-muted transition-colors hover:text-ink">
          Cadastrar um grupo à mão
        </summary>
        <p className="mb-4 mt-2 text-xs leading-relaxed text-muted">
          Só é preciso quando o grupo ainda não apareceu na sincronização. O caminho normal é
          puxar os grupos pela conexão.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 text-sm">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">ID do grupo</span>
            <input value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="120363…@g.us" className={inputCls} />
          </label>
          <label className="min-w-[220px] flex-1 text-sm">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Nome amigável</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Clientes Turma 12" className={inputCls} />
          </label>
          <button
            onClick={add}
            disabled={saving || !groupId.trim() || !nome.trim()}
            className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted"
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
    </div>
  );
}

function AcoesEmMassa({
  quantos,
  tags,
  onAplicar,
  onLimpar,
}: {
  quantos: number;
  tags: GroupTag[];
  onAplicar: (tagId: string, acao: 'adicionar' | 'remover') => Promise<void>;
  onLimpar: () => void;
}) {
  const [tagId, setTagId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function rodar(acao: 'adicionar' | 'remover') {
    setOcupado(true);
    await onAplicar(tagId, acao);
    setOcupado(false);
  }
  return (
    <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue/40 bg-surface2 px-3 py-2.5 text-sm shadow-lg">
      <b className="mr-1">
        {quantos} {quantos === 1 ? 'grupo marcado' : 'grupos marcados'}
      </b>
      {tags.length === 0 ? (
        <span className="text-xs text-muted">Crie uma tag para aplicar em massa.</span>
      ) : (
        <>
          <select
            aria-label="Tag"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink [color-scheme:dark]"
          >
            <option value="">Escolha a tag…</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!tagId || ocupado}
            onClick={() => void rodar('adicionar')}
            className="rounded-lg bg-blue px-3 py-1.5 text-[13px] font-semibold text-on-blue disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted"
          >
            Pôr a tag
          </button>
          <button
            type="button"
            disabled={!tagId || ocupado}
            onClick={() => void rodar('remover')}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] text-muted hover:text-ink disabled:cursor-not-allowed"
          >
            Tirar a tag
          </button>
        </>
      )}
      <button type="button" onClick={onLimpar} className="ml-auto text-[13px] text-muted hover:text-ink">
        Desmarcar
      </button>
    </div>
  );
}

/** Criar, renomear, trocar a cor e apagar tags. */
function GerenciarTags({
  tags,
  contagem,
  onMudou,
  onApagou,
}: {
  tags: GroupTag[];
  contagem: Record<string, number>;
  onMudou: (tags: GroupTag[]) => void;
  onApagou: (id: string) => void;
}) {
  const [nova, setNova] = useState('');
  const [cor, setCor] = useState<string>(CORES_DE_TAG[tags.length % CORES_DE_TAG.length]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editando, setEditando] = useState<{ id: string; nome: string; cor: string } | null>(null);

  async function criar() {
    setOcupado(true);
    setErro(null);
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: nova, cor }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setOcupado(false);
    if (!res?.ok) {
      setErro(body?.error ?? 'Não foi possível criar a tag.');
      return;
    }
    onMudou([...tags, body as GroupTag]);
    setNova('');
    setCor(CORES_DE_TAG[(tags.length + 1) % CORES_DE_TAG.length]);
  }

  async function salvar() {
    if (!editando) return;
    setOcupado(true);
    setErro(null);
    const res = await fetch(`/api/tags/${editando.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: editando.nome, cor: editando.cor }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setOcupado(false);
    if (!res?.ok) {
      setErro(body?.error ?? 'Não foi possível salvar a tag.');
      return;
    }
    onMudou(tags.map((t) => (t.id === editando.id ? (body as GroupTag) : t)));
    setEditando(null);
  }

  async function apagar(t: GroupTag) {
    const n = contagem[t.id] ?? 0;
    if (!window.confirm(`Apagar a tag “${t.nome}”? ${n ? `Ela sai de ${n} ${n === 1 ? 'grupo' : 'grupos'}; os grupos continuam.` : ''}`)) return;
    const res = await fetch(`/api/tags/${t.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setErro('Não foi possível apagar a tag.');
      return;
    }
    onMudou(tags.filter((x) => x.id !== t.id));
    onApagou(t.id);
  }

  return (
    <details className="mb-5 rounded-xl2 border border-border bg-surface p-4" open={tags.length === 0}>
      <summary className="cursor-pointer text-sm font-semibold">
        🏷 Tags <span className="font-normal text-muted">· {tags.length ? `${tags.length} ${tags.length === 1 ? 'criada' : 'criadas'}` : 'crie a primeira'}</span>
      </summary>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nova.trim()) void criar();
          }}
          placeholder="Ex.: Live Peru, Turma Japão março…"
          aria-label="Nome da nova tag"
          maxLength={40}
          className={`${inputCls} py-2.5 sm:max-w-xs`}
        />
        <SeletorDeCor valor={cor} onChange={setCor} />
        <button
          type="button"
          onClick={() => void criar()}
          disabled={!nova.trim() || ocupado}
          className="rounded-xl bg-blue px-4 py-2.5 text-sm font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted"
        >
          ＋ Criar tag
        </button>
      </div>
      {erro && (
        <p className="mt-2 text-xs text-[#ffb183]" role="alert">
          {erro}
        </p>
      )}

      {tags.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
          {tags.map((t) =>
            editando?.id === t.id ? (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <input
                  value={editando.nome}
                  onChange={(e) => setEditando({ ...editando, nome: e.target.value })}
                  aria-label="Nome da tag"
                  maxLength={40}
                  className={`${inputCls} py-2 sm:max-w-[220px]`}
                  autoFocus
                />
                <SeletorDeCor valor={editando.cor} onChange={(c) => setEditando({ ...editando, cor: c })} />
                <button type="button" onClick={() => void salvar()} disabled={ocupado} className="rounded-lg bg-blue px-3 py-1.5 text-[13px] font-semibold text-on-blue">
                  Salvar
                </button>
                <button type="button" onClick={() => setEditando(null)} className="text-[13px] text-muted hover:text-ink">
                  Cancelar
                </button>
              </li>
            ) : (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2.5">
                <TagChip tag={t} />
                <span className="text-xs text-muted">
                  {contagem[t.id] ?? 0} {(contagem[t.id] ?? 0) === 1 ? 'grupo' : 'grupos'}
                </span>
                <button
                  type="button"
                  onClick={() => setEditando({ id: t.id, nome: t.nome, cor: t.cor })}
                  className="ml-auto text-[13px] text-muted hover:text-ink"
                >
                  Editar
                </button>
                <button type="button" onClick={() => void apagar(t)} className="text-[13px] text-muted hover:text-[#ffb183]">
                  Apagar
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </details>
  );
}

function SeletorDeCor({ valor, onChange }: { valor: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Cor da tag">
      {CORES_DE_TAG.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={valor.toLowerCase() === c.toLowerCase()}
          aria-label={`Cor ${c}`}
          onClick={() => onChange(c)}
          className={`h-6 w-6 rounded-full border-2 transition-transform ${
            valor.toLowerCase() === c.toLowerCase() ? 'scale-110 border-ink' : 'border-transparent'
          }`}
          style={{ background: c }}
        />
      ))}
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
      className={`relative h-6 w-[42px] shrink-0 rounded-full transition-colors disabled:cursor-wait ${
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
