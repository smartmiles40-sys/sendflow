'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Sequence, SequenceStep } from '@/lib/types';
import { categoriaLabel } from '@/lib/categories';
import { SequenceStepRow } from './SequenceStepRow';
import { inputCls } from './ui';

function newStep(ordem: number): SequenceStep {
  return {
    id: crypto.randomUUID(),
    ordem,
    dia_offset: 0,
    hora_tipo: 'fixo',
    hora_fixa: '09:00',
    offset_min: null,
    mensagem: '',
    tipo: 'texto',
    midia_url: null,
    mencionar_todos: false,
  };
}

// Parse the API's field errors (e.g. "steps[3].mensagem") into a per-step map plus
// any top-level ones (e.g. "nome").
function parseErrors(errors: { field: string; message: string }[]): {
  nome?: string;
  steps: Record<number, Record<string, string>>;
  other: string[];
} {
  const out = { steps: {} as Record<number, Record<string, string>>, other: [] as string[] } as {
    nome?: string;
    steps: Record<number, Record<string, string>>;
    other: string[];
  };
  for (const e of errors) {
    if (e.field === 'nome') {
      out.nome = e.message;
      continue;
    }
    const m = /^steps\[(\d+)\]\.(.+)$/.exec(e.field);
    if (m) {
      const idx = Number(m[1]);
      out.steps[idx] = { ...(out.steps[idx] ?? {}), [m[2]]: e.message };
    } else {
      out.other.push(e.message);
    }
  }
  return out;
}

export function SequenceEditorClient({ sequence }: { sequence: Sequence }) {
  const [nome, setNome] = useState(sequence.nome);
  const [steps, setSteps] = useState<SequenceStep[]>(
    Array.isArray(sequence.steps) ? sequence.steps : [],
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof parseErrors> | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function patchStep(index: number, patch: Partial<SequenceStep>) {
    setSteps((s) => s.map((st, i) => (i === index ? { ...st, ...patch } : st)));
    setSavedAt(null);
  }

  function move(index: number, delta: number) {
    setSteps((s) => {
      const j = index + delta;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    setSavedAt(null);
  }

  function remove(index: number) {
    setSteps((s) => s.filter((_, i) => i !== index));
    setSavedAt(null);
  }

  function addStep() {
    setSteps((s) => [...s, newStep(s.length)]);
    setSavedAt(null);
  }

  async function save() {
    setSubmitError(null);
    setFieldErrors(null);
    setSavedAt(null);
    setSaving(true);
    // Renumber ordem by position so it always matches the visible order.
    const payloadSteps = steps.map((s, i) => ({ ...s, ordem: i }));
    try {
      const res = await fetch(`/api/sequences/${sequence.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), steps: payloadSteps }),
      });
      if (res.ok) {
        setSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        errors?: { field: string; message: string }[];
      };
      if (body.errors?.length) {
        setFieldErrors(parseErrors(body.errors));
        setSubmitError('Corrija os campos destacados e salve de novo.');
      } else {
        setSubmitError(body.error ?? 'Não foi possível salvar o roteiro. Tente de novo.');
      }
    } catch {
      setSubmitError('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1.5 text-[13px] text-muted">
        <Link href="/sequencias" className="transition-colors hover:text-ink">
          Sequências
        </Link>{' '}
        / <b className="font-semibold text-ink">Editar roteiro</b>
      </div>
      <div className="mb-[22px] flex items-center gap-2.5">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Editar roteiro</h1>
        <span className="rounded-full border border-blue2/30 bg-blue2/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#DFEFC5]">
          {categoriaLabel(sequence.categoria)}
        </span>
      </div>

      <div className="mb-5">
        <label className="mb-[9px] block text-[13px] font-semibold" htmlFor="seq-nome">
          Nome do roteiro
        </label>
        <input
          id="seq-nome"
          type="text"
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            setSavedAt(null);
          }}
          className={inputCls}
        />
        {fieldErrors?.nome && (
          <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
            {fieldErrors.nome}
          </div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
          Passos ({steps.length})
        </h2>
      </div>

      <div className="flex flex-col gap-3.5">
        {steps.length === 0 ? (
          <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
            Nenhum passo ainda. Adicione o primeiro abaixo.
          </div>
        ) : (
          steps.map((s, i) => (
            <SequenceStepRow
              key={s.id}
              step={s}
              index={i}
              total={steps.length}
              errors={fieldErrors?.steps[i]}
              onChange={(patch) => patchStep(i, patch)}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onRemove={() => remove(i)}
            />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={addStep}
        className="mt-3.5 w-full rounded-xl2 border border-dashed border-[#1F555A] bg-surface2 px-4 py-3.5 text-center text-sm font-semibold text-blue2 transition-colors hover:border-blue2 hover:bg-white/5"
      >
        ＋ Adicionar passo
      </button>

      {submitError && (
        <p className="mt-5 text-sm text-[#ffb183]" role="alert">
          {submitError}
        </p>
      )}
      {fieldErrors?.other.length ? (
        <ul className="mt-2 list-inside list-disc text-sm text-[#ffb183]">
          {fieldErrors.other.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted disabled:shadow-none"
        >
          {saving ? 'Salvando…' : '💾 Salvar roteiro'}
        </button>
        <Link
          href="/sequencias"
          className="rounded-xl border border-border px-5 py-[13px] text-sm font-semibold text-ink transition-colors hover:bg-white/5"
        >
          Voltar
        </Link>
        {savedAt && (
          <span className="text-sm text-green" role="status" aria-live="polite">
            ✓ Salvo às {savedAt}
          </span>
        )}
      </div>
    </div>
  );
}
