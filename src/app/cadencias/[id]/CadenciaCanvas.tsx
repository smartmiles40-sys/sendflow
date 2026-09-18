'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Campaign } from '@/lib/types';
import { passoEditavel, type Cadencia, type DestinoCadencia } from '@/lib/cadencia';
import { categoriaLabel } from '@/lib/categories';
import { diaPorExtenso, partesSP, somarDias } from '@/lib/hora-sp';
import { StatusChip } from '@/components/StatusChip';
import { Field, inputCls } from '@/components/ui';
import { DestinoForm, resumoDestino, useOpcoesDestino } from '@/components/cadencia/DestinoForm';
import { PassoEditor, type PassoRascunho } from '@/components/cadencia/PassoEditor';

interface Kpi {
  destinatarios: number;
  enviados: number;
  entregues: number;
  lidos: number;
  respostas: number;
  falhas: number;
  pendentes: number;
}

type Passo = Campaign & { kpi: Kpi | null };

const ICONE: Record<string, string> = { texto: '💬', imagem: '🖼️', video: '🎬', pdf: '📄' };

/** "em 3h", "em 2 dias", "há 5 min" — o quanto falta, que é o que a equipe quer saber. */
function relativo(iso: string, agora: number): string {
  const diff = new Date(iso).getTime() - agora;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  let txt: string;
  if (min < 1) txt = 'agora';
  else if (min < 60) txt = `${min} min`;
  else if (min < 60 * 36) txt = `${Math.round(min / 60)}h`;
  else txt = `${Math.round(min / 1440)} dias`;
  if (txt === 'agora') return 'agora';
  return diff >= 0 ? `em ${txt}` : `há ${txt}`;
}

/** Sugestão de data para uma mensagem inserida entre duas (ou no fim). */
function sugerirData(anterior: string | null, proxima: string | null): string {
  const base = Date.now() + 60 * 60_000;
  if (!anterior) {
    const t = proxima ? Math.min(base, new Date(proxima).getTime() - 60 * 60_000) : base;
    return new Date(Math.max(t, Date.now() + 10 * 60_000)).toISOString();
  }
  const umDiaDepois = somarDias(anterior, 1);
  if (!proxima || new Date(umDiaDepois) < new Date(proxima)) {
    return new Date(Math.max(new Date(umDiaDepois).getTime(), base)).toISOString();
  }
  // Não cabe um dia inteiro: fica no meio, arredondado para 15 min.
  const meio = (new Date(anterior).getTime() + new Date(proxima).getTime()) / 2;
  return new Date(Math.round(meio / 900_000) * 900_000).toISOString();
}

function linhaDeResultado(p: Passo, paraGrupos: boolean): string | null {
  const k = p.kpi;
  if (!k || !k.destinatarios) return null;
  if (paraGrupos) {
    const falhas = k.falhas ? ` · ${k.falhas} com falha` : '';
    const pend = k.pendentes ? ` · ${k.pendentes} na fila` : '';
    return `${k.enviados}/${k.destinatarios} grupos receberam${falhas}${pend}`;
  }
  return `${k.enviados} enviadas · ${k.entregues} entregues · ${k.lidos} lidas · ${k.respostas} respostas${k.falhas ? ` · ${k.falhas} falhas` : ''}`;
}

export function CadenciaCanvas({ id }: { id: string }) {
  const router = useRouter();
  const opcoes = useOpcoesDestino();
  const [cadencia, setCadencia] = useState<Cadencia | null>(null);
  const [passos, setPassos] = useState<Passo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<PassoRascunho | null>(null);
  const [painel, setPainel] = useState<'destino' | 'duplicar' | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [ativando, setAtivando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/cadencias/${id}`, { cache: 'no-store' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(b.error ?? 'Não foi possível carregar a cadência.');
        return;
      }
      setCadencia(b.cadencia);
      setPassos(b.passos ?? []);
      setErro(null);
    } catch {
      setErro('Sem conexão com o servidor.');
    } finally {
      setCarregando(false);
      setAgora(Date.now());
    }
  }, [id]);

  // Recarrega a cada 20 s: é assim que "Agendada" vira "Enviando…" e "Enviada" sozinho.
  useEffect(() => {
    // Primeira leitura num timeout: chamar a busca direto no corpo do efeito dispara
    // setState em cascata (regra react-hooks/set-state-in-effect).
    const primeira = setTimeout(() => void carregar(), 0);
    const t = setInterval(() => void carregar(), 20_000);
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [carregar]);

  const paraGrupos = cadencia?.alvo !== 'contatos';
  const pausadas = useMemo(() => passos.filter((p) => p.status === 'rascunho'), [passos]);

  function abrirNovo(indice: number) {
    const anterior = passos[indice - 1]?.enviar_em ?? null;
    const proxima = passos[indice]?.enviar_em ?? null;
    const modelo = passos[indice - 1];
    setEditando({
      id: null,
      numero: indice + 1,
      tipo: 'texto',
      mensagem: '',
      midia_url: null,
      mencionar_todos: modelo?.mencionar_todos ?? false,
      enviar_em: sugerirData(anterior, proxima),
    });
  }

  function abrirPasso(p: Passo, indice: number) {
    setEditando({
      id: p.id,
      numero: indice + 1,
      tipo: p.tipo,
      mensagem: p.mensagem,
      midia_url: p.midia_url,
      mencionar_todos: p.mencionar_todos,
      enviar_em: p.enviar_em ?? new Date().toISOString(),
      status: p.status,
    });
  }

  async function ativarPausadas() {
    setAtivando(true);
    const falhas: string[] = [];
    for (const p of pausadas) {
      const r = await fetch(`/api/cadencias/${id}/passos/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => null);
      if (!r?.ok) {
        const b = await r?.json().catch(() => ({}));
        falhas.push(`${p.enviar_em ? partesSP(p.enviar_em).hora : ''} ${b?.errors?.[0]?.message ?? b?.error ?? ''}`.trim());
      }
    }
    setAtivando(false);
    await carregar();
    if (falhas.length) {
      setErro(`${falhas.length} mensagem(ns) não puderam ser ativadas — provavelmente com data no passado. Abra cada uma e ajuste a data.`);
    }
  }

  async function apagarCadencia() {
    if (!window.confirm('Apagar esta cadência? As mensagens que ainda não saíram não serão enviadas. As já enviadas continuam no histórico de Campanhas.')) return;
    const r = await fetch(`/api/cadencias/${id}`, { method: 'DELETE' });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(b.error ?? 'Não foi possível apagar.');
      return;
    }
    router.push('/cadencias');
  }

  if (carregando) {
    return <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">Carregando cadência…</div>;
  }
  if (!cadencia) {
    return (
      <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
        {erro ?? 'Cadência não encontrada.'}{' '}
        <Link href="/cadencias" className="font-semibold text-blue2">
          Voltar
        </Link>
      </div>
    );
  }

  // Dia de cada mensagem, para mostrar o cabeçalho só quando o dia muda.
  const dias = passos.map((p) => (p.enviar_em ? diaPorExtenso(p.enviar_em) : 'sem data'));

  return (
    <div>
      <div className="mb-1.5 text-[13px] text-muted">
        <Link href="/cadencias" className="transition-colors hover:text-ink">
          Cadências
        </Link>{' '}
        / <b className="font-semibold text-ink">{cadencia.nome}</b>
      </div>

      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="break-words font-display text-[24px] font-semibold leading-tight tracking-[-0.01em] md:text-[26px]">
            {cadencia.nome}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="rounded-full border border-blue2/30 bg-blue2/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#DFEFC5]">
              {categoriaLabel(cadencia.categoria)}
            </span>
            <span>
              {passos.length} {passos.length === 1 ? 'mensagem' : 'mensagens'} ·{' '}
              {passos.filter((p) => p.status === 'enviada').length} enviadas
            </span>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setPainel('duplicar')}
            className="flex-1 rounded-xl border border-border px-3.5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:bg-white/5 sm:flex-none"
          >
            ⧉ Duplicar
          </button>
          <button
            type="button"
            onClick={() => void apagarCadencia()}
            className="flex-1 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold text-[#ffb183] transition-colors hover:bg-orange/10 sm:flex-none"
          >
            Apagar
          </button>
        </div>
      </div>

      {erro && (
        <div role="alert" className="mb-4 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]">
          {erro}
        </div>
      )}

      {pausadas.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-sm">
          <span className="min-w-0 flex-1 text-[#C9DCD8]">
            ⏸ {pausadas.length} {pausadas.length === 1 ? 'mensagem pausada' : 'mensagens pausadas'} — não {pausadas.length === 1 ? 'sai' : 'saem'} até ativar.
          </span>
          <button
            type="button"
            onClick={() => void ativarPausadas()}
            disabled={ativando}
            className="rounded-xl bg-blue px-3.5 py-2 text-[13px] font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted"
          >
            {ativando ? 'Ativando…' : '▶ Ativar todas'}
          </button>
        </div>
      )}

      {/* O "canvas": fundo pontilhado e uma linha do tempo vertical, do início ao fim. */}
      <div
        className="rounded-xl2 border border-border px-3 py-6 sm:px-6"
        style={{
          backgroundColor: 'var(--color-bg)',
          backgroundImage: 'radial-gradient(circle, rgba(143,174,169,.16) 1px, transparent 1.2px)',
          backgroundSize: '22px 22px',
        }}
      >
        <div className="mx-auto max-w-[620px]">
          {/* Nó de início: para quem vai */}
          <div className="rounded-xl2 border border-border bg-surface px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue2/40 text-sm">▶</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Para quem vai</div>
                <div className="truncate text-sm font-semibold">{resumoDestino(cadencia, opcoes)}</div>
              </div>
              <button
                type="button"
                onClick={() => setPainel('destino')}
                className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-white/5"
              >
                Trocar
              </button>
            </div>
          </div>

          {passos.map((p, i) => {
            const dia = dias[i];
            const novoDia = i === 0 || dia !== dias[i - 1];
            const editavel = passoEditavel(p.status);
            const hora = p.enviar_em ? partesSP(p.enviar_em).hora : '--:--';
            const resultado = linhaDeResultado(p, paraGrupos);
            return (
              <div key={p.id}>
                <Conector onInserir={() => abrirNovo(i)} rotulo={`Inserir mensagem antes da ${i + 1}`} />
                {novoDia && (
                  <div className="mb-3 text-center">
                    <span className="rounded-full border border-border bg-surface2 px-3 py-1 inline-block text-[12px] font-semibold text-[#C9DCD8] first-letter:uppercase">
                      {dia}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => (editavel ? abrirPasso(p, i) : router.push(`/campanhas/${p.id}`))}
                  className={`group block w-full rounded-xl2 border bg-surface px-4 py-3.5 text-left transition-colors hover:border-blue2 ${
                    p.status === 'rascunho' ? 'border-dashed border-[#2A6166] opacity-80' : 'border-border'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold ${
                        p.status === 'enviada' ? 'bg-green/20 text-green' : 'bg-blue text-on-blue'
                      }`}
                    >
                      {p.status === 'enviada' ? '✓' : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-xl font-semibold tabular-nums">{hora}</span>
                        <span className="text-[12px] text-muted">
                          {ICONE[p.tipo]} {p.enviar_em ? relativo(p.enviar_em, agora) : ''}
                        </span>
                      </div>
                    </div>
                    {p.status === 'rascunho' ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted/15 px-2.5 py-1 text-xs font-semibold text-[#C9DCD8]">
                        ⏸ Pausada
                      </span>
                    ) : (
                      <StatusChip status={p.status} />
                    )}
                  </div>

                  <div className="mt-2.5 flex gap-3">
                    {p.tipo === 'imagem' && p.midia_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.midia_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                    )}
                    <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words text-[13.5px] leading-snug text-[#C9DCD8]">
                      {p.mensagem || <span className="text-muted">(sem texto)</span>}
                    </p>
                  </div>

                  {(resultado || p.status === 'erro') && (
                    <div className="mt-2.5 border-t border-border pt-2 text-[12px] text-muted">
                      {resultado ?? 'O envio deu erro — abra para corrigir e reagendar.'}
                    </div>
                  )}
                  <div className="mt-1.5 text-[11.5px] font-semibold text-blue2 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                    {editavel ? 'Toque para editar ›' : 'Ver quem recebeu ›'}
                  </div>
                </button>
              </div>
            );
          })}

          <Conector />
          <button
            type="button"
            onClick={() => abrirNovo(passos.length)}
            className="block w-full rounded-xl2 border border-dashed border-blue2/50 bg-blue/[0.06] px-4 py-4 text-center text-sm font-semibold text-blue2 transition-colors hover:bg-blue/[0.12]"
          >
            + {passos.length ? 'Adicionar a próxima mensagem' : 'Criar a mensagem 1'}
          </button>
        </div>
      </div>

      {editando && (
        <PassoEditor
          cadenciaId={id}
          inicial={editando}
          paraGrupos={paraGrupos}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            void carregar();
          }}
        />
      )}

      {painel === 'destino' && (
        <PainelDestino
          cadencia={cadencia}
          opcoes={opcoes}
          onFechar={() => setPainel(null)}
          onSalvo={() => {
            setPainel(null);
            void carregar();
          }}
        />
      )}
      {painel === 'duplicar' && (
        <PainelDuplicar
          cadencia={cadencia}
          onFechar={() => setPainel(null)}
          onCriada={(novaId) => router.push(`/cadencias/${novaId}`)}
        />
      )}
    </div>
  );
}

/** A linha que liga um nó ao próximo; com `onInserir`, vira um "+" para encaixar uma mensagem ali. */
function Conector({ onInserir, rotulo }: { onInserir?: () => void; rotulo?: string }) {
  return (
    <div className="relative flex h-10 items-center justify-center">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#2A6166]" aria-hidden="true" />
      {onInserir && (
        <button
          type="button"
          onClick={onInserir}
          aria-label={rotulo}
          title={rotulo}
          className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[#2A6166] bg-bg text-sm text-muted transition-colors hover:border-blue2 hover:text-blue2"
        >
          +
        </button>
      )}
    </div>
  );
}

function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={titulo}>
      <button type="button" aria-label="Fechar" onClick={onFechar} className="absolute inset-0 bg-black/60" />
      <div className="relative max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <h2 className="flex-1 font-display text-lg font-semibold">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg px-2 py-1 text-xl leading-none text-muted hover:bg-white/5 hover:text-ink">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PainelDestino({
  cadencia,
  opcoes,
  onFechar,
  onSalvo,
}: {
  cadencia: Cadencia;
  opcoes: ReturnType<typeof useOpcoesDestino>;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [destino, setDestino] = useState<DestinoCadencia>({
    alvo: cadencia.alvo,
    audience_id: cadencia.audience_id,
    group_ids: cadencia.group_ids,
    list_ids: cadencia.list_ids,
    connection_id: cadencia.connection_id,
  });
  const [erro, setErro] = useState<string | undefined>();
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true);
    const r = await fetch(`/api/cadencias/${cadencia.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(destino),
    }).catch(() => null);
    setOcupado(false);
    const b = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setErro(b?.errors?.[0]?.message ?? b?.error ?? 'Não foi possível salvar.');
      return;
    }
    onSalvo();
  }

  return (
    <Modal titulo="Para quem vai" onFechar={onFechar}>
      <DestinoForm valor={destino} onChange={setDestino} opcoes={opcoes} erro={erro} />
      <p className="mb-4 text-xs leading-relaxed text-muted">
        Vale para as mensagens que ainda não saíram. As já enviadas continuam registradas para onde foram.
      </p>
      <button
        type="button"
        onClick={() => void salvar()}
        disabled={ocupado}
        className="w-full rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-on-blue hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted"
      >
        {ocupado ? 'Salvando…' : 'Salvar destino'}
      </button>
    </Modal>
  );
}

function PainelDuplicar({
  cadencia,
  onFechar,
  onCriada,
}: {
  cadencia: Cadencia;
  onFechar: () => void;
  onCriada: (id: string) => void;
}) {
  const [nome, setNome] = useState(`${cadencia.nome} (cópia)`);
  const [dias, setDias] = useState('7');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function duplicar() {
    setOcupado(true);
    const r = await fetch(`/api/cadencias/${cadencia.id}/duplicar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, dias: Number(dias) }),
    }).catch(() => null);
    setOcupado(false);
    const b = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setErro(b?.errors?.[0]?.message ?? b?.error ?? 'Não foi possível duplicar.');
      return;
    }
    onCriada(b.id);
  }

  return (
    <Modal titulo="Duplicar para a próxima" onFechar={onFechar}>
      <Field label="Nome da nova cadência">
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Empurrar as datas em" hint="· dias">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          value={dias}
          onChange={(e) => setDias(e.target.value)}
          className={inputCls}
        />
      </Field>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        Copia o destino e todas as mensagens. As cópias nascem <b className="text-ink">pausadas</b>, para
        você revisar o texto antes; depois é só tocar em “Ativar todas”.
      </p>
      {erro && (
        <p className="mb-3 text-sm text-[#ffb183]" role="alert">
          {erro}
        </p>
      )}
      <button
        type="button"
        onClick={() => void duplicar()}
        disabled={ocupado}
        className="w-full rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-on-blue hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted"
      >
        {ocupado ? 'Duplicando…' : '⧉ Criar cópia'}
      </button>
    </Modal>
  );
}
