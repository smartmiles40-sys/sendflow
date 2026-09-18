'use client';

import { useEffect, useRef, useState } from 'react';
import type { CampaignType } from '@/lib/types';
import { uploadMedia } from '@/lib/upload-client';
import { isoDeSP, partesSP } from '@/lib/hora-sp';
import { Field, SegButton, Switch, inputCls } from '@/components/ui';
import { WhatsAppPreview } from '@/components/WhatsAppPreview';

const TIPOS: { key: CampaignType; label: string }[] = [
  { key: 'texto', label: 'Só texto' },
  { key: 'imagem', label: 'Imagem' },
  { key: 'video', label: 'Vídeo' },
  { key: 'pdf', label: 'PDF' },
];

const ACEITA: Record<Exclude<CampaignType, 'texto'>, string> = {
  imagem: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4',
  pdf: 'application/pdf',
};

export interface PassoRascunho {
  /** Nulo = mensagem nova. */
  id: string | null;
  numero: number;
  tipo: CampaignType;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  enviar_em: string;
  status?: string;
}

/**
 * Painel de edição de UMA mensagem da cadência.
 * No computador abre como gaveta à direita (formulário + prévia lado a lado); no
 * celular ocupa a tela inteira e a prévia vai para baixo do formulário.
 */
export function PassoEditor({
  cadenciaId,
  inicial,
  paraGrupos,
  onFechar,
  onSalvo,
}: {
  cadenciaId: string;
  inicial: PassoRascunho;
  paraGrupos: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const partes = partesSP(inicial.enviar_em);
  const [tipo, setTipo] = useState<CampaignType>(inicial.tipo);
  const [mensagem, setMensagem] = useState(inicial.mensagem);
  const [midiaUrl, setMidiaUrl] = useState<string | null>(inicial.midia_url);
  const [mencionar, setMencionar] = useState(inicial.mencionar_todos);
  const [data, setData] = useState(partes.data);
  const [hora, setHora] = useState(partes.hora);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const novo = inicial.id === null;

  // Esc fecha; e a página de trás não rola enquanto o painel está aberto.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', tecla);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', tecla);
      document.body.style.overflow = antes;
    };
  }, [onFechar]);

  async function enviarArquivo(f: File) {
    setEnviandoArquivo(true);
    setErros((e) => ({ ...e, midia_url: '' }));
    const r = await uploadMedia(f);
    setEnviandoArquivo(false);
    if ('error' in r) setErros((e) => ({ ...e, midia_url: r.error }));
    else setMidiaUrl(r.url);
  }

  async function chamar(metodo: 'POST' | 'PATCH' | 'DELETE', corpo?: unknown) {
    const url = novo
      ? `/api/cadencias/${cadenciaId}/passos`
      : `/api/cadencias/${cadenciaId}/passos/${inicial.id}`;
    setOcupado(true);
    setErroGeral(null);
    try {
      const r = await fetch(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (Array.isArray(b.errors)) {
          setErros(Object.fromEntries(b.errors.map((x: { field: string; message: string }) => [x.field, x.message])));
        }
        setErroGeral(b.error ?? (Array.isArray(b.errors) ? 'Confira os campos marcados.' : 'Não foi possível salvar.'));
        return false;
      }
      onSalvo();
      return true;
    } catch {
      setErroGeral('Sem conexão com o servidor. Tente de novo.');
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function salvar() {
    const enviarEm = isoDeSP(data, hora);
    if (!enviarEm) {
      setErros({ enviar_em: 'Escolha a data e a hora.' });
      return;
    }
    void chamar(novo ? 'POST' : 'PATCH', {
      tipo,
      mensagem,
      midia_url: tipo === 'texto' ? null : midiaUrl,
      mencionar_todos: paraGrupos && mencionar,
      enviar_em: enviarEm,
    });
  }

  const pausada = inicial.status === 'rascunho';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Mensagem ${inicial.numero}`}>
      <button type="button" aria-label="Fechar" onClick={onFechar} className="absolute inset-0 bg-black/60" />

      <div className="relative flex h-full w-full max-w-[980px] flex-col bg-bg shadow-[-20px_0_60px_rgba(0,0,0,.45)] md:border-l md:border-border">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3.5 md:px-6">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue font-display text-sm font-semibold text-on-blue">
            {inicial.numero}
          </span>
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
            {novo ? 'Nova mensagem' : `Mensagem ${inicial.numero}`}
          </h2>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg px-2.5 py-1.5 text-xl leading-none text-muted transition-colors hover:bg-white/5 hover:text-ink"
            aria-label="Fechar"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <Field label="Quando sai" hint="· horário de Brasília" error={erros.enviar_em}>
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2.5">
                  <input
                    type="date"
                    aria-label="Data do envio"
                    value={data}
                    onChange={(e) => setData(e.target.value)}
                    className={`${inputCls} [color-scheme:dark]`}
                  />
                  <input
                    type="time"
                    aria-label="Hora do envio"
                    value={hora}
                    onChange={(e) => setHora(e.target.value)}
                    className={`${inputCls} [color-scheme:dark]`}
                  />
                </div>
              </Field>

              <Field label="Tipo de conteúdo" error={erros.tipo}>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {TIPOS.map((t) => (
                    <SegButton key={t.key} on={tipo === t.key} onClick={() => setTipo(t.key)}>
                      {t.label}
                    </SegButton>
                  ))}
                </div>
              </Field>

              {tipo !== 'texto' && (
                <Field label="Mídia" error={erros.midia_url}>
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept={ACEITA[tipo]}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void enviarArquivo(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => arquivoRef.current?.click()}
                    disabled={enviandoArquivo}
                    className="block w-full rounded-xl border border-dashed border-[#1F555A] bg-surface2 px-4 py-[18px] text-center text-[13px] text-muted transition-colors hover:border-blue2 disabled:cursor-wait"
                  >
                    {enviandoArquivo ? (
                      'Enviando arquivo…'
                    ) : midiaUrl ? (
                      <>
                        <span className="font-semibold text-green">✓ Arquivo anexado</span>
                        <br />
                        <span className="text-xs">toque para trocar</span>
                      </>
                    ) : (
                      <>
                        📎 <b className="text-blue2">Escolher arquivo</b>
                        <br />
                        <span className="text-xs">
                          {tipo === 'imagem' ? 'JPEG, PNG ou WebP' : tipo === 'video' ? 'MP4' : 'PDF'} · até 20 MB
                        </span>
                      </>
                    )}
                  </button>
                </Field>
              )}

              <Field label="Mensagem" error={erros.mensagem}>
                <textarea
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  rows={7}
                  placeholder="Bom dia, pessoal! ☀️ …"
                  className={`${inputCls} min-h-[160px] resize-y leading-relaxed`}
                />
              </Field>

              {paraGrupos && (
                <Field>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface2 px-3.5 py-3">
                    <span className="text-sm">
                      <span className="font-semibold">Mencionar todos</span>
                      <span className="mt-0.5 block font-normal text-muted">
                        marca @todos os participantes de cada grupo
                      </span>
                    </span>
                    <Switch checked={mencionar} onChange={setMencionar} label="Mencionar todos" />
                  </label>
                </Field>
              )}
            </div>

            <div className="lg:sticky lg:top-0">
              <WhatsAppPreview
                tipo={tipo}
                mensagem={mensagem}
                midiaUrl={midiaUrl}
                mencionarTodos={paraGrupos && mencionar}
              />
            </div>
          </div>
        </div>

        <footer className="border-t border-border px-4 py-3.5 md:px-6">
          {erroGeral && (
            <p className="mb-3 text-sm text-[#ffb183]" role="alert">
              {erroGeral}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={salvar}
              disabled={ocupado || enviandoArquivo}
              className="flex-1 rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted sm:flex-none"
            >
              {ocupado ? 'Salvando…' : novo ? '📅 Agendar mensagem' : pausada ? '▶️ Salvar e reativar' : '💾 Salvar'}
            </button>
            {!novo && !pausada && (
              <button
                type="button"
                onClick={() => void chamar('PATCH', { pausar: true })}
                disabled={ocupado}
                className="rounded-xl border border-border px-4 py-[13px] text-sm font-semibold text-ink transition-colors hover:bg-white/5 disabled:opacity-60"
              >
                ⏸ Pausar
              </button>
            )}
            {!novo && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Apagar a mensagem ${inicial.numero}? Ela não será enviada.`)) {
                    void chamar('DELETE');
                  }
                }}
                disabled={ocupado}
                className="rounded-xl px-4 py-[13px] text-sm font-semibold text-[#ffb183] transition-colors hover:bg-orange/10 disabled:opacity-60 sm:ml-auto"
              >
                Apagar
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
