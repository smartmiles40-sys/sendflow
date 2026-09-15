'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Audience, Group, Sequence, SequenceStep } from '@/lib/types';
import {
  AudiencePicker,
  resolveAudience,
  type AudienceMode,
} from '@/components/AudiencePicker';
import { Field, SegButton, inputCls } from '@/components/ui';
import { useRelogio } from '@/lib/useRelogio';
import { CATEGORIAS, categoriaLabel, type CategoriaKey } from '@/lib/categories';
import {
  computeStepEnviarEm,
  renderTemplate,
  formatHora,
  formatData,
  diaSemana,
} from '@/lib/sequence';
import { formatWhen } from '@/lib/format';

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}$/;

const tipoBadge: Record<string, string> = {
  texto: '💬 Texto',
  imagem: '🖼️ Imagem',
  video: '🎬 Vídeo',
  pdf: '📄 PDF',
};

interface AulaRow {
  id: string;
  data: string;
  hora: string;
  tema: string;
}

interface StepPreview {
  step: SequenceStep;
  enviarEm: string;
  past: boolean;
  mensagem: string;
}

function newAulaRow(): AulaRow {
  return { id: crypto.randomUUID(), data: '', hora: '19:00', tema: '' };
}

export function SequenceDispatchClient({ sequence }: { sequence: Sequence }) {
  const [aulas, setAulas] = useState<AulaRow[]>(() => [newAulaRow()]);
  const [categoria, setCategoria] = useState<CategoriaKey>(sequence.categoria);

  // Audience picker state (same shape as the composer).
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('todos');
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupQuery, setGroupQuery] = useState('');

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    criadas: number;
    puladas: number;
    aulasCount: number;
  } | null>(null);

  // Fetch audiences + groups on mount so both picker modes are ready.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [audRes, grpRes] = await Promise.allSettled([
        fetch('/api/audiences'),
        fetch('/api/groups'),
      ]);
      if (!alive) return;
      if (audRes.status === 'fulfilled' && audRes.value.ok) {
        setAudiences(((await audRes.value.json().catch(() => [])) as Audience[]) ?? []);
      }
      if (grpRes.status === 'fulfilled' && grpRes.value.ok) {
        setGroups(((await grpRes.value.json().catch(() => [])) as Group[]) ?? []);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const steps = useMemo(
    () => (Array.isArray(sequence.steps) ? sequence.steps : []),
    [sequence.steps],
  );

  function addAula() {
    setAulas((prev) => [...prev, newAulaRow()]);
  }

  function removeAula(id: string) {
    setAulas((prev) => (prev.length > 1 ? prev.filter((a) => a.id !== id) : prev));
    setErrors((e) => {
      let changed = false;
      const next = { ...e };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${id}:`)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : e;
    });
  }

  function updateAula(id: string, patch: Partial<Pick<AulaRow, 'data' | 'hora' | 'tema'>>) {
    setAulas((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    setErrors((e) => {
      let changed = false;
      const next = { ...e };
      for (const field of Object.keys(patch)) {
        const key = `${id}:${field}`;
        if (next[key]) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : e;
    });
  }

  function rowError(id: string, field: 'data' | 'hora' | 'tema'): string | undefined {
    return errors[`${id}:${field}`];
  }

  function toggleExpanded(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  // Prévia por aula: para as linhas com data+hora preenchidas, calcula o horário e a
  // mensagem de cada passo. "Agora" vem de um relógio que é estado de verdade e anda de
  // minuto em minuto — chamar Date.now() aqui dentro quebraria a pureza da renderização
  // e o selo de "passo já vencido" poderia congelar sem ninguém perceber.
  const agora = useRelogio();
  const aulaPreviews = useMemo(() => {
    const now = agora;
    return aulas.map((row) => {
      const dataOk = DATA_RE.test(row.data);
      const horaOk = HORA_RE.test(row.hora);
      const temaOk = row.tema.trim().length > 0;
      const filled = dataOk && horaOk && temaOk;
      if (!dataOk || !horaOk) {
        return { row, dataOk, horaOk, temaOk, filled, items: [] as StepPreview[] };
      }
      const vars = {
        tema: row.tema.trim(),
        hora: formatHora(row.hora),
        data: formatData(row.data),
        diasemana: diaSemana(row.data),
      };
      const items: StepPreview[] = steps.map((step) => {
        const enviarEm = computeStepEnviarEm(row.data, row.hora, step);
        const past = new Date(enviarEm).getTime() <= now;
        return { step, enviarEm, past, mensagem: renderTemplate(step.mensagem, vars) };
      });
      return { row, dataOk, horaOk, temaOk, filled, items };
    });
  }, [aulas, steps, agora]);

  const filledPreviews = aulaPreviews.filter((p) => p.filled);
  const totalFuture = filledPreviews.reduce(
    (sum, p) => sum + p.items.filter((i) => !i.past).length,
    0,
  );
  const canSubmit =
    filledPreviews.some((p) => p.items.some((i) => !i.past)) && !busy;

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((s) =>
      s.includes(groupId) ? s.filter((x) => x !== groupId) : [...s, groupId],
    );
  }

  async function submit() {
    setSubmitError(null);
    setResult(null);
    const map: Record<string, string> = {};
    for (const row of aulas) {
      if (!DATA_RE.test(row.data)) map[`${row.id}:data`] = 'Escolha a data da aula.';
      if (!HORA_RE.test(row.hora)) map[`${row.id}:hora`] = 'Informe a hora da aula.';
      if (!row.tema.trim()) map[`${row.id}:tema`] = 'Informe o tema da aula.';
    }
    if (Object.keys(map).length) {
      setErrors(map);
      return;
    }
    setErrors({});
    setBusy(true);
    const { audience_id, group_ids } = resolveAudience(
      audienceMode,
      selectedAudienceId,
      selectedGroupIds,
    );
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aulas: aulas.map((a) => ({ data: a.data, hora: a.hora, tema: a.tema.trim() })),
          categoria,
          audience_id,
          group_ids,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          criadas: unknown[];
          puladas: number;
          porAula: unknown[];
        };
        setResult({
          criadas: (body.criadas ?? []).length,
          puladas: body.puladas ?? 0,
          aulasCount: (body.porAula ?? []).length,
        });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        errors?: { field: string; message: string }[];
      };
      if (body.errors?.length) {
        const map2: Record<string, string> = {};
        let generic: string | null = null;
        for (const err of body.errors) {
          const m = /^aulas\[(\d+)\]\.(data|hora|tema)$/.exec(err.field);
          const row = m ? aulas[Number(m[1])] : undefined;
          if (m && row) {
            map2[`${row.id}:${m[2]}`] = err.message;
          } else {
            generic = generic ? `${generic} ${err.message}` : err.message;
          }
        }
        setErrors(map2);
        if (generic) setSubmitError(generic);
      } else {
        setSubmitError(body.error ?? 'Não foi possível agendar as aulas. Tente de novo.');
      }
    } catch {
      setSubmitError('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl2 border border-green/30 bg-green/[0.06] p-6 text-center">
          <div className="mb-2 text-3xl">✅</div>
          <h1 className="font-display text-xl font-semibold">Aulas agendadas!</h1>
          <p className="mt-2 text-sm text-muted">
            <b className="text-ink">{result.criadas}</b>{' '}
            {result.criadas === 1 ? 'campanha agendada' : 'campanhas agendadas'} em{' '}
            <b className="text-ink">{result.aulasCount}</b>{' '}
            {result.aulasCount === 1 ? 'aula' : 'aulas'}
            {result.puladas > 0 && (
              <>
                {' '}
                · <b className="text-ink">{result.puladas}</b>{' '}
                {result.puladas === 1 ? 'pulada' : 'puladas'} (horário no passado)
              </>
            )}
            .
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Link
              href="/campanhas"
              className="rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-white shadow-[0_6px_20px_rgba(1,71,255,.35)] transition-colors hover:bg-[#0a54ff]"
            >
              Ver campanhas
            </Link>
            <Link
              href="/sequencias"
              className="rounded-xl border border-border px-5 py-[13px] text-sm font-semibold text-ink transition-colors hover:bg-white/5"
            >
              Voltar aos roteiros
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 text-[13px] text-muted">
        <Link href="/sequencias" className="transition-colors hover:text-ink">
          Sequências
        </Link>{' '}
        / <b className="font-semibold text-ink">Disparar aulas</b>
      </div>
      <div className="mb-[22px] flex items-center gap-2.5">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">
          {sequence.nome}
        </h1>
        <span className="rounded-full border border-blue2/30 bg-blue2/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#9cc0ff]">
          {categoriaLabel(sequence.categoria)}
        </span>
      </div>

      <div className="grid grid-cols-1 items-start gap-[26px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* FORM */}
        <div className="rounded-xl2 border border-border bg-surface p-[22px]">
          <div className="mb-5">
            <div className="mb-[9px] flex items-center justify-between">
              <label className="text-[13px] font-semibold">Aulas</label>
              <span className="text-xs text-muted">
                {aulas.length} {aulas.length === 1 ? 'aula' : 'aulas'}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {aulas.map((row, i) => (
                <div key={row.id} className="rounded-xl border border-border bg-surface2 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted">Aula {i + 1}</span>
                    {aulas.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remover aula ${i + 1}`}
                        onClick={() => removeAula(row.id)}
                        className="text-xs font-semibold text-muted transition-colors hover:text-[#ffb183]"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <input
                        type="date"
                        aria-label={`Data da aula ${i + 1}`}
                        value={row.data}
                        onChange={(e) => updateAula(row.id, { data: e.target.value })}
                        className={`${inputCls} [color-scheme:dark]`}
                      />
                      {rowError(row.id, 'data') && (
                        <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
                          {rowError(row.id, 'data')}
                        </div>
                      )}
                    </div>
                    <div>
                      <input
                        type="time"
                        aria-label={`Hora da aula ${i + 1}`}
                        value={row.hora}
                        onChange={(e) => updateAula(row.id, { hora: e.target.value })}
                        className={`${inputCls} [color-scheme:dark]`}
                      />
                      {rowError(row.id, 'hora') && (
                        <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
                          {rowError(row.id, 'hora')}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2">
                    <input
                      type="text"
                      aria-label={`Tema da aula ${i + 1}`}
                      value={row.tema}
                      onChange={(e) => updateAula(row.id, { tema: e.target.value })}
                      placeholder="Como precificar pacotes"
                      className={inputCls}
                    />
                    {rowError(row.id, 'tema') && (
                      <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
                        {rowError(row.id, 'tema')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addAula}
              className="mt-3 w-full rounded-xl border border-dashed border-border px-4 py-2.5 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
            >
              + Adicionar aula
            </button>
          </div>

          <Field label="Categoria" hint="· onde as campanhas vão aparecer">
            <div className="flex flex-wrap gap-2">
              {CATEGORIAS.map((cat) => (
                <SegButton
                  key={cat.key}
                  on={categoria === cat.key}
                  onClick={() => setCategoria(cat.key)}
                >
                  {cat.label}
                </SegButton>
              ))}
            </div>
          </Field>

          <AudiencePicker
            audiences={audiences}
            groups={groups}
            mode={audienceMode}
            onModeChange={setAudienceMode}
            selectedAudienceId={selectedAudienceId}
            onSelectAudience={setSelectedAudienceId}
            selectedGroupIds={selectedGroupIds}
            onToggleGroup={toggleGroup}
            groupQuery={groupQuery}
            onGroupQueryChange={setGroupQuery}
          />

          {submitError && (
            <p className="mt-4 text-sm text-[#ffb183]" role="alert">
              {submitError}
            </p>
          )}

          <div className="mt-[22px] flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-white shadow-[0_6px_20px_rgba(1,71,255,.35)] transition-colors hover:bg-[#0a54ff] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {busy
                ? 'Agendando…'
                : totalFuture > 0
                  ? `📅 Agendar ${totalFuture} ${totalFuture === 1 ? 'mensagem' : 'mensagens'}`
                  : '📅 Agendar tudo'}
            </button>
            <Link
              href="/sequencias"
              className="rounded-xl border border-border px-5 py-[13px] text-sm font-semibold text-ink transition-colors hover:bg-white/5"
            >
              Cancelar
            </Link>
          </div>
        </div>

        {/* PREVIEW */}
        <div className="lg:sticky lg:top-[26px]">
          <div className="mb-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Prévia do mês ({filledPreviews.length} {filledPreviews.length === 1 ? 'aula' : 'aulas'})
          </div>

          {filledPreviews.length === 0 ? (
            <div className="rounded-xl2 border border-dashed border-border bg-surface p-6 text-sm text-muted">
              Preencha <b className="text-ink">data</b>, <b className="text-ink">hora</b> e{' '}
              <b className="text-ink">tema</b> de ao menos uma aula para ver os horários e as
              mensagens já com as variáveis substituídas.
            </div>
          ) : (
            <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto pr-1">
              {filledPreviews.map(({ row, items }) => {
                const future = items.filter((i) => !i.past);
                const past = items.filter((i) => i.past);
                const times = future.map((i) => new Date(i.enviarEm).getTime());
                const firstEnviarEm = times.length ? new Date(Math.min(...times)).toISOString() : null;
                const lastEnviarEm = times.length ? new Date(Math.max(...times)).toISOString() : null;
                const isOpen = !!expanded[row.id];
                return (
                  <div key={row.id} className="rounded-xl2 border border-border bg-surface p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-ink">
                        📅 {diaSemana(row.data)} {formatData(row.data)} · {formatHora(row.hora)} —{' '}
                        {row.tema.trim()}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.id)}
                        className="shrink-0 text-[12px] font-semibold text-blue2 transition-colors hover:text-ink"
                      >
                        {isOpen ? 'ocultar mensagens ▴' : 'ver mensagens ▾'}
                      </button>
                    </div>
                    <div className="mt-1.5 text-[13px] text-muted">
                      <b className="text-ink">{future.length}</b>{' '}
                      {future.length === 1 ? 'mensagem' : 'mensagens'}
                      {future.length > 0 && (
                        <>
                          {' '}
                          · primeira <b className="text-ink">{formatWhen(firstEnviarEm)}</b> · última{' '}
                          <b className="text-ink">{formatWhen(lastEnviarEm)}</b>
                        </>
                      )}
                      {past.length > 0 && (
                        <>
                          {' '}
                          ·{' '}
                          <b className="text-ink">{past.length}</b>{' '}
                          {past.length === 1 ? 'não será agendada' : 'não serão agendadas'}
                        </>
                      )}
                    </div>

                    {isOpen && (
                      <div className="mt-3 flex flex-col gap-2.5">
                        {items.map(({ step, enviarEm, past: stepPast, mensagem }, i) => (
                          <div
                            key={step.id}
                            className={`rounded-xl border border-border bg-surface2 p-3.5 ${
                              stepPast ? 'opacity-55' : ''
                            }`}
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue/15 font-display text-[11px] font-semibold text-[#9cc0ff]">
                                {i + 1}
                              </span>
                              <span className="font-semibold text-ink">{formatWhen(enviarEm)}</span>
                              <span className="text-muted">{tipoBadge[step.tipo] ?? step.tipo}</span>
                              {stepPast && (
                                <span className="ml-auto rounded-full bg-muted/15 px-2 py-0.5 text-[11px] font-semibold text-muted">
                                  não será agendada (horário no passado)
                                </span>
                              )}
                            </div>

                            <div className="ml-auto max-w-[92%] rounded-[10px] rounded-tr-[2px] bg-[#005c4b] px-2.5 pb-2 pt-1.5 text-[13px] leading-[1.42] text-[#e9edef]">
                              {step.midia_url && step.tipo !== 'texto' && (
                                <div className="mb-1.5 overflow-hidden rounded-[7px]">
                                  {step.tipo === 'imagem' ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={step.midia_url}
                                      alt=""
                                      className="block max-h-40 w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex items-center justify-center gap-1.5 bg-black/40 py-4 text-[#a7c4bc]">
                                      <span>{step.tipo === 'video' ? '🎬' : '📄'}</span>
                                      <span className="text-[11px]">
                                        {step.tipo === 'video' ? 'Vídeo anexado' : 'PDF anexado'}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                              {step.mencionar_todos && <span className="text-[#53bdeb]">@todos </span>}
                              <span className="whitespace-pre-wrap break-words">{mensagem}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
