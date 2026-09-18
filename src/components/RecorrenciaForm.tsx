'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { temMidia, type Audience, type CampaignType, type TipoComMidia, type Group, type Recorrencia } from '@/lib/types';
import { WhatsAppPreview } from '@/components/WhatsAppPreview';
import { AudiencePicker, resolveAudience, type AudienceMode } from '@/components/AudiencePicker';
import { Field, SegButton, Switch, inputCls } from '@/components/ui';
import { CATEGORIAS, type CategoriaKey } from '@/lib/categories';
import { DIAS_SEMANA_LABEL, describeRecorrencia } from '@/lib/recurrence';
import { uploadMedia } from '@/lib/upload-client';

const tipos: { key: CampaignType; label: string }[] = [
  { key: 'texto', label: 'Só texto' },
  { key: 'imagem', label: 'Imagem' },
  { key: 'video', label: 'Vídeo' },
  { key: 'pdf', label: 'PDF' },
];

const acceptByTipo: Record<TipoComMidia, string> = {
  imagem: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4',
  pdf: 'application/pdf',
};

// Abreviação de 3 letras para os botões de dia (seg, ter, …), derivada do rótulo completo.
const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Modo do seletor de público a partir do molde salvo.
function modeOf(rec: Recorrencia | null | undefined): AudienceMode {
  if (rec?.audience_id) return 'salvo';
  if (rec?.group_ids?.length) return 'grupos';
  return 'todos';
}

export function RecorrenciaForm({ initial }: { initial?: Recorrencia | null }) {
  const router = useRouter();
  const editing = Boolean(initial);
  const fileRef = useRef<HTMLInputElement>(null);

  const [nome, setNome] = useState(initial?.nome ?? '');
  const [categoria, setCategoria] = useState<CategoriaKey>(initial?.categoria ?? 'comunidade');
  const [diaSemana, setDiaSemana] = useState<number>(initial?.dia_semana ?? 1);
  const [hora, setHora] = useState(initial?.hora ?? '09:00');
  const [tipo, setTipo] = useState<CampaignType>(initial?.tipo ?? 'texto');
  const [mensagem, setMensagem] = useState(initial?.mensagem ?? '');
  const [midiaUrl, setMidiaUrl] = useState<string | null>(initial?.midia_url ?? null);
  const [midiaMeta, setMidiaMeta] = useState<{ name: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mencionar, setMencionar] = useState(initial?.mencionar_todos ?? false);

  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>(modeOf(initial));
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | null>(
    initial?.audience_id ?? null,
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(initial?.group_ids ?? []);
  const [groupQuery, setGroupQuery] = useState('');

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [aRes, gRes] = await Promise.all([fetch('/api/audiences'), fetch('/api/groups')]);
        if (!alive) return;
        if (aRes.ok) setAudiences((await aRes.json()) as Audience[]);
        if (gRes.ok) setGroups((await gRes.json()) as Group[]);
      } catch {
        // Sem os públicos/grupos o form ainda funciona no modo "Todos os grupos".
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const midiaLabel = useMemo(() => {
    if (midiaMeta) return midiaMeta.name;
    if (!midiaUrl) return null;
    return safeDecode(midiaUrl.split('/').pop() ?? '');
  }, [midiaMeta, midiaUrl]);

  function clearError(field: string) {
    setErrors((e) => {
      if (!e[field]) return e;
      const { [field]: _omit, ...rest } = e;
      return rest;
    });
  }

  function pickTipo(t: CampaignType) {
    setTipo(t);
    if (t === 'texto') {
      setMidiaUrl(null);
      setMidiaMeta(null);
    }
    clearError('midia_url');
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((s) =>
      s.includes(groupId) ? s.filter((x) => x !== groupId) : [...s, groupId],
    );
  }

  async function uploadFile(file: File) {
    setUploading(true);
    clearError('midia_url');
    setMidiaUrl(null);
    setMidiaMeta(null);
    const out = await uploadMedia(file);
    if ('url' in out) {
      setMidiaUrl(out.url);
      setMidiaMeta({ name: file.name, size: file.size });
    } else {
      setErrors((e) => ({ ...e, midia_url: out.error }));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit() {
    setSubmitError(null);
    setErrors({});
    const { audience_id, group_ids } = resolveAudience(
      audienceMode,
      selectedAudienceId,
      selectedGroupIds,
    );
    if (audienceMode === 'salvo' && !audience_id) {
      setErrors({ audience: 'Escolha um público salvo.' });
      return;
    }
    if (audienceMode === 'grupos' && !group_ids) {
      setErrors({ audience: 'Selecione ao menos um grupo.' });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(
        editing ? `/api/recorrencias/${initial!.id}` : '/api/recorrencias',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome,
            categoria,
            dia_semana: diaSemana,
            hora,
            tipo,
            mensagem,
            midia_url: midiaUrl,
            mencionar_todos: mencionar,
            audience_id,
            group_ids,
          }),
        },
      );
      if (res.ok) {
        router.push('/recorrencias');
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        errors?: { field: string; message: string }[];
      };
      if (body.errors?.length) {
        setErrors(Object.fromEntries(body.errors.map((e) => [e.field, e.message])));
      } else {
        setSubmitError(body.error ?? 'Não foi possível salvar a recorrência.');
      }
    } catch {
      setSubmitError('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-[22px]">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">
          {editing ? 'Editar recorrência' : 'Nova recorrência'}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {describeRecorrencia(diaSemana, hora)} · a plataforma agenda as próximas 6 semanas e vai
          repondo sozinha.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-[26px] lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-xl2 border border-border bg-surface p-4 sm:p-[22px]">
          <Field label="Nome" error={errors.nome}>
            <input
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                clearError('nome');
              }}
              placeholder="Comunidade — bom dia de segunda"
              className={inputCls}
            />
          </Field>

          <Field label="Categoria" hint="· organiza o painel por produto">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
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

          <Field label="Dia da semana" error={errors.dia_semana}>
            <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
              {DIA_CURTO.map((label, i) => (
                <SegButton key={label} on={diaSemana === i} onClick={() => setDiaSemana(i)}>
                  <span className="sr-only">{DIAS_SEMANA_LABEL[i]}</span>
                  <span aria-hidden="true">{label}</span>
                </SegButton>
              ))}
            </div>
          </Field>

          <Field label="Hora" hint="· horário de Brasília" error={errors.hora}>
            <input
              type="time"
              value={hora}
              onChange={(e) => {
                setHora(e.target.value);
                clearError('hora');
              }}
              className={`${inputCls} [color-scheme:dark] max-w-[160px]`}
            />
          </Field>

          <Field label="Tipo de conteúdo">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {tipos.map((t) => (
                <SegButton key={t.key} on={tipo === t.key} onClick={() => pickTipo(t.key)}>
                  {t.label}
                </SegButton>
              ))}
            </div>
          </Field>

          {temMidia(tipo) && (
            <Field label="Mídia" error={errors.midia_url}>
              <input
                ref={fileRef}
                type="file"
                accept={acceptByTipo[tipo]}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="block w-full rounded-xl border border-dashed border-[#1F555A] bg-surface2 px-4 py-[18px] text-center text-[13px] text-muted transition-colors hover:border-blue2 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <span>Enviando arquivo…</span>
                ) : midiaLabel ? (
                  <>
                    <span className="font-semibold text-green">✓ {midiaLabel}</span>
                    <br />
                    <span className="text-xs text-muted">
                      {midiaMeta ? `${formatBytes(midiaMeta.size)} · ` : ''}clique para trocar
                    </span>
                  </>
                ) : (
                  <>
                    📎 Arraste um arquivo aqui ou <b className="text-blue2">clique para enviar</b>
                    <br />
                    <span className="text-xs">
                      {tipo === 'imagem' ? 'JPEG, PNG ou WebP' : tipo === 'video' ? 'MP4' : 'PDF'} ·
                      até 20 MB
                    </span>
                  </>
                )}
              </button>
            </Field>
          )}

          <Field label="Mensagem" error={errors.mensagem}>
            <textarea
              value={mensagem}
              onChange={(e) => {
                setMensagem(e.target.value);
                clearError('mensagem');
              }}
              rows={4}
              placeholder="Bom dia, pessoal! ☀️ …"
              className={`${inputCls} min-h-[120px] resize-y leading-relaxed`}
            />
          </Field>

          <Field>
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border bg-surface2 px-3.5 py-3">
              <span className="text-sm">
                <span className="font-semibold">Mencionar todos</span>
                <span className="mt-0.5 block font-normal text-muted">
                  marca @todos os participantes de cada grupo
                </span>
              </span>
              <Switch checked={mencionar} onChange={setMencionar} label="Mencionar todos" />
            </label>
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
            error={errors.audience}
            onClearError={() => clearError('audience')}
          />

          <div className="mt-4 flex gap-2.5 rounded-xl border border-blue2/30 bg-blue/[0.08] px-3.5 py-3 text-[12.5px] text-[#C9DCD8]">
            <span aria-hidden="true">🔄</span>
            <span>
              Ao salvar, as ocorrências futuras ainda não enviadas são{' '}
              <b className="text-[#DCE9E6]">reescritas com este conteúdo</b>. O que já foi enviado
              não muda.
            </span>
          </div>

          {submitError && (
            <p className="mt-4 text-sm text-[#ffb183]" role="alert">
              {submitError}
            </p>
          )}

          <div className="mt-[22px] flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || uploading}
              className="rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted disabled:shadow-none"
            >
              {busy ? 'Salvando…' : editing ? '💾 Salvar alterações' : '🔄 Criar recorrência'}
            </button>
            <Link
              href="/recorrencias"
              className="rounded-xl border border-border px-5 py-[13px] text-sm font-semibold text-ink transition-colors hover:bg-white/5"
            >
              Cancelar
            </Link>
          </div>
        </div>

        <div className="sticky top-[26px]">
          <WhatsAppPreview
            tipo={tipo}
            mensagem={mensagem}
            midiaUrl={midiaUrl}
            mencionarTodos={mencionar}
          />
        </div>
      </div>
    </div>
  );
}
