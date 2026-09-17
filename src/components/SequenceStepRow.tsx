'use client';

import { useRef, useState } from 'react';
import type { CampaignType, SequenceStep } from '@/lib/types';
import { Switch, inputCls } from './ui';
import { uploadMedia } from '@/lib/upload-client';

const diaOffsetOptions: { value: number; label: string }[] = [
  { value: 0, label: 'No dia da aula' },
  { value: -1, label: '1 dia antes' },
  { value: -2, label: '2 dias antes' },
  { value: -3, label: '3 dias antes' },
];

const offsetMinOptions: { value: number; label: string }[] = [
  { value: -60, label: '1h antes' },
  { value: -30, label: '30 min antes' },
  { value: 0, label: 'No horário' },
  { value: 5, label: '+5 min' },
  { value: 10, label: '+10 min' },
  { value: 15, label: '+15 min' },
  { value: 20, label: '+20 min' },
];

const tipoOptions: { value: CampaignType; label: string }[] = [
  { value: 'texto', label: 'Só texto' },
  { value: 'imagem', label: 'Imagem' },
  { value: 'video', label: 'Vídeo' },
  { value: 'pdf', label: 'PDF' },
];

const acceptByTipo: Record<Exclude<CampaignType, 'texto'>, string> = {
  imagem: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4',
  pdf: 'application/pdf',
};

const CHIPS = ['{{tema}}', '{{hora}}', '{{data}}', '{{diasemana}}'] as const;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function SequenceStepRow({
  step,
  index,
  total,
  errors,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  step: SequenceStep;
  index: number;
  total: number;
  errors?: Record<string, string>;
  onChange: (patch: Partial<SequenceStep>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const err = errors ?? {};

  function insertChip(token: string) {
    const ta = textareaRef.current;
    const value = step.mensagem;
    if (!ta) {
      onChange({ mensagem: value + token });
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange({ mensagem: next });
    // Restore caret just after the inserted token on the next frame.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function pickTipo(t: CampaignType) {
    if (t === 'texto') onChange({ tipo: t, midia_url: null });
    else onChange({ tipo: t });
    setUploadError(null);
  }

  function pickHoraTipo(t: 'fixo' | 'relativo') {
    if (t === step.hora_tipo) return;
    if (t === 'fixo') onChange({ hora_tipo: 'fixo', hora_fixa: step.hora_fixa ?? '09:00' });
    else onChange({ hora_tipo: 'relativo', offset_min: step.offset_min ?? 0 });
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    const out = await uploadMedia(file);
    if ('url' in out) onChange({ midia_url: out.url });
    else setUploadError(out.error);
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  const midiaLabel = step.midia_url ? safeDecode(step.midia_url.split('/').pop() ?? 'Mídia') : null;

  return (
    <div className="rounded-xl2 border border-border bg-surface p-[18px]">
      {/* Header: number + reorder/remove */}
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue/15 font-display text-[13px] font-semibold text-[#DFEFC5]">
          {index + 1}
        </span>
        <span className="text-[13px] font-semibold text-muted">Passo {index + 1}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label="Subir passo"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label="Descer passo"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remover passo"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-orange/30 text-[#ffb183] transition-colors hover:bg-orange/10"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Quando */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-[9px] block text-[13px] font-semibold">Quando</span>
          <select
            aria-label={`Passo ${index + 1}: dia`}
            value={step.dia_offset}
            onChange={(e) => onChange({ dia_offset: Number(e.target.value) })}
            className={`${inputCls} [color-scheme:dark] cursor-pointer`}
          >
            {diaOffsetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="block">
          <span className="mb-[9px] block text-[13px] font-semibold">Horário</span>
          <div className="mb-2 flex gap-2">
            <HoraTipoBtn on={step.hora_tipo === 'fixo'} onClick={() => pickHoraTipo('fixo')}>
              🕐 Relógio fixo
            </HoraTipoBtn>
            <HoraTipoBtn on={step.hora_tipo === 'relativo'} onClick={() => pickHoraTipo('relativo')}>
              ↔ Relativo à aula
            </HoraTipoBtn>
          </div>
          {step.hora_tipo === 'fixo' ? (
            <input
              type="time"
              aria-label={`Passo ${index + 1}: hora fixa`}
              value={step.hora_fixa ?? ''}
              onChange={(e) => onChange({ hora_fixa: e.target.value })}
              className={`${inputCls} [color-scheme:dark]`}
            />
          ) : (
            <select
              aria-label={`Passo ${index + 1}: offset relativo`}
              value={step.offset_min ?? 0}
              onChange={(e) => onChange({ offset_min: Number(e.target.value) })}
              className={`${inputCls} [color-scheme:dark] cursor-pointer`}
            >
              {offsetMinOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {(err.hora_fixa || err.offset_min) && (
            <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
              {err.hora_fixa ?? err.offset_min}
            </div>
          )}
        </div>
      </div>

      {/* Mensagem */}
      <div className="mb-4">
        <span className="mb-[9px] block text-[13px] font-semibold">Mensagem</span>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => insertChip(c)}
              className="rounded-lg border border-blue2/30 bg-blue2/10 px-2 py-1 font-mono text-[11px] text-[#DFEFC5] transition-colors hover:bg-blue2/20"
            >
              {c}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          aria-label={`Passo ${index + 1}: mensagem`}
          value={step.mensagem}
          onChange={(e) => onChange({ mensagem: e.target.value })}
          rows={4}
          placeholder="Bom dia! Hoje tem aula às {{hora}}…"
          className={`${inputCls} min-h-[104px] resize-y leading-relaxed`}
        />
        {err.mensagem && (
          <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
            {err.mensagem}
          </div>
        )}
      </div>

      {/* Tipo + mídia */}
      <div className="mb-4">
        <span className="mb-[9px] block text-[13px] font-semibold">Tipo de conteúdo</span>
        <select
          aria-label={`Passo ${index + 1}: tipo`}
          value={step.tipo}
          onChange={(e) => pickTipo(e.target.value as CampaignType)}
          className={`${inputCls} [color-scheme:dark] cursor-pointer`}
        >
          {tipoOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {step.tipo !== 'texto' && (
          <div className="mt-2.5">
            <input
              ref={fileRef}
              type="file"
              accept={acceptByTipo[step.tipo]}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
            {step.midia_url ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface2 px-3.5 py-2.5">
                {step.tipo === 'imagem' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={step.midia_url}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-black/30 text-lg">
                    {step.tipo === 'video' ? '🎬' : '📄'}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-green">✓ {midiaLabel}</span>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="shrink-0 text-[12px] font-semibold text-blue2 transition-colors hover:text-ink disabled:opacity-50"
                >
                  trocar
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ midia_url: null })}
                  className="shrink-0 text-[12px] font-semibold text-[#ffb183] transition-colors hover:text-ink"
                >
                  remover
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="block w-full rounded-xl border border-dashed border-[#1F555A] bg-surface2 px-4 py-3 text-center text-[13px] text-muted transition-colors hover:border-blue2 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  'Enviando arquivo…'
                ) : (
                  <>
                    📎 <b className="text-blue2">Enviar {step.tipo}</b> · até 20 MB
                  </>
                )}
              </button>
            )}
            {(uploadError || err.midia_url) && (
              <div className="mt-1.5 text-xs text-[#ffb183]" role="alert">
                {uploadError ?? err.midia_url}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mencionar todos */}
      <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface2 px-3.5 py-2.5">
        <span className="text-sm font-semibold">Mencionar todos</span>
        <Switch
          checked={step.mencionar_todos}
          onChange={(v) => onChange({ mencionar_todos: v })}
          label={`Passo ${index + 1}: mencionar todos`}
        />
      </label>
    </div>
  );
}

function HoraTipoBtn({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex-1 rounded-xl border px-2 py-2 text-center text-[12.5px] font-semibold transition-colors ${
        on
          ? 'border-blue bg-blue/15 text-ink'
          : 'border-border bg-surface2 text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
