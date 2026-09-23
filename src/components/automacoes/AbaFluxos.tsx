'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ROTULO_GATILHO, type TipoGatilho } from '@/lib/automacao/tipos';
import { inputCls, SegButton } from '@/components/ui';
import {
  api,
  ApagarInline,
  Aviso,
  btnPequeno,
  btnPrimario,
  Chip,
  ChipStatus,
  ErroApi,
  haQuanto,
  Vazio,
  type FluxoResumo,
  type GatilhoLinha,
  type ProblemaApi,
  type PropsAba,
} from './comum';
import { NovoFluxoModal } from './NovoFluxoModal';

type Filtro = 'todos' | 'ativo' | 'rascunho' | 'pausado';

/** Rótulo curto do gatilho para o chip no cartão do fluxo. */
function rotuloCurto(g: GatilhoLinha): string {
  switch (g.tipo) {
    case 'palavra_chave': {
      const p = g.config.palavras ?? [];
      return `🔑 ${p.slice(0, 2).join(', ')}${p.length > 2 ? ` +${p.length - 2}` : ''}`;
    }
    case 'boas_vindas':
      return '👋 Boas-vindas';
    case 'padrao':
      return '🤖 Resposta padrão';
    case 'link_ref':
      return `🔗 ${g.config.codigo ?? 'link'}`;
    case 'anuncio':
      return '📣 Anúncio';
    case 'tag_adicionada':
      return `🏷️ tag ${g.config.tag ?? ''}`;
    case 'webhook':
      return '🪝 Webhook';
    default:
      return ROTULO_GATILHO[g.tipo as TipoGatilho] ?? g.tipo;
  }
}

export function AbaFluxos({ dados, recarregar }: PropsAba) {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [modal, setModal] = useState(false);
  const [aviso, setAviso] = useState<{ fluxoId: string; msg: string; problemas: ProblemaApi[] } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const porFluxo = useMemo(() => {
    const m = new Map<string, GatilhoLinha[]>();
    for (const g of dados.gatilhos) m.set(g.fluxo_id, [...(m.get(g.fluxo_id) ?? []), g]);
    return m;
  }, [dados.gatilhos]);

  const pastas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const visiveis = dados.fluxos.filter(
      (f) =>
        (filtro === 'todos' || f.status === filtro) &&
        (!termo || f.nome.toLowerCase().includes(termo) || (f.descricao ?? '').toLowerCase().includes(termo)),
    );
    const grupos = new Map<string, FluxoResumo[]>();
    for (const f of visiveis) {
      const chave = f.pasta?.trim() || '';
      grupos.set(chave, [...(grupos.get(chave) ?? []), f]);
    }
    // Sem pasta primeiro; o resto em ordem alfabética.
    return [...grupos.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'pt-BR')));
  }, [dados.fluxos, busca, filtro]);

  async function mudarStatus(f: FluxoResumo, status: 'ativo' | 'pausado') {
    setOcupado(f.id);
    setAviso(null);
    try {
      await api(`/api/fluxos/${f.id}`, { method: 'PATCH', json: { status } });
      await recarregar();
    } catch (e) {
      setAviso({
        fluxoId: f.id,
        msg: e instanceof Error ? e.message : String(e),
        problemas: e instanceof ErroApi ? e.problemas : [],
      });
    } finally {
      setOcupado(null);
    }
  }

  async function duplicar(f: FluxoResumo) {
    setOcupado(f.id);
    try {
      await api(`/api/fluxos/${f.id}/duplicar`, { method: 'POST' });
      await recarregar();
    } catch (e) {
      setAviso({ fluxoId: f.id, msg: e instanceof Error ? e.message : String(e), problemas: [] });
    } finally {
      setOcupado(null);
    }
  }

  async function apagar(f: FluxoResumo) {
    try {
      await api(`/api/fluxos/${f.id}`, { method: 'DELETE' });
      await recarregar();
    } catch (e) {
      setAviso({ fluxoId: f.id, msg: e instanceof Error ? e.message : String(e), problemas: [] });
    }
  }

  const total = dados.fluxos.length;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar fluxo pelo nome…"
          className={`${inputCls} lg:max-w-xs`}
          aria-label="Buscar fluxo"
        />
        <div className="grid grid-cols-4 gap-1.5 lg:flex lg:flex-1">
          {(['todos', 'ativo', 'rascunho', 'pausado'] as Filtro[]).map((f) => (
            <SegButton key={f} on={filtro === f} onClick={() => setFiltro(f)}>
              {f === 'todos' ? 'Todos' : f === 'ativo' ? 'Ativos' : f === 'rascunho' ? 'Rascunhos' : 'Pausados'}
            </SegButton>
          ))}
        </div>
        <button type="button" onClick={() => setModal(true)} className={`${btnPrimario} w-full lg:w-auto`}>
          + Novo fluxo
        </button>
      </div>

      {aviso && (
        <div className="mb-4">
          <Aviso>
            <p className="font-semibold">{aviso.msg}</p>
            {aviso.problemas.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px]">
                {aviso.problemas.slice(0, 8).map((p, i) => (
                  <li key={i}>{p.mensagem}</li>
                ))}
                {aviso.problemas.length > 8 && <li>… e mais {aviso.problemas.length - 8}.</li>}
              </ul>
            )}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {aviso.problemas.length > 0 && (
                <Link href={`/automacoes/${aviso.fluxoId}`} className="font-semibold text-[#D7F264] underline underline-offset-2">
                  Abrir no editor para corrigir ›
                </Link>
              )}
              <button type="button" onClick={() => setAviso(null)} className="text-muted underline underline-offset-2">
                Fechar
              </button>
            </div>
          </Aviso>
        </div>
      )}

      {total === 0 ? (
        <Vazio>
          <p className="font-semibold text-ink">Nenhum fluxo ainda.</p>
          <p className="mt-1">
            Comece por um <b className="text-ink">modelo pronto</b> — boas-vindas com menu, captura de lead, palavra-chave de
            destino — e só troque o texto. Depois ligue um gatilho para ele começar sozinho.
          </p>
          <button type="button" onClick={() => setModal(true)} className={`${btnPrimario} mt-4`}>
            Escolher um modelo
          </button>
        </Vazio>
      ) : pastas.length === 0 ? (
        <Vazio>Nenhum fluxo com esse filtro.</Vazio>
      ) : (
        <div className="flex flex-col gap-6">
          {pastas.map(([pasta, fluxos]) => (
            <section key={pasta || '_'}>
              {pastas.length > 1 || pasta ? (
                <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {pasta ? `📁 ${pasta}` : 'Sem pasta'}
                </h2>
              ) : null}
              <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                {fluxos.map((f) => {
                  const gs = porFluxo.get(f.id) ?? [];
                  const taxa = f.execucoes_total > 0 ? Math.round((f.concluidas_total / f.execucoes_total) * 100) : null;
                  return (
                    <article
                      key={f.id}
                      className="flex flex-col rounded-xl2 border border-border bg-surface p-[18px] transition-colors hover:border-blue2/60"
                    >
                      <div className="mb-1 flex items-start gap-2">
                        <Link
                          href={`/automacoes/${f.id}`}
                          className="min-w-0 flex-1 break-words font-display text-lg font-semibold leading-tight hover:text-[#D7F264]"
                        >
                          {f.nome}
                        </Link>
                        <ChipStatus status={f.status} />
                      </div>
                      {f.descricao && <p className="line-clamp-2 text-[13px] text-muted">{f.descricao}</p>}

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {gs.length === 0 ? (
                          <span className="text-[12px] text-muted">
                            Sem gatilho — só começa pela caixa de conversa ou por outro fluxo.
                          </span>
                        ) : (
                          gs.slice(0, 4).map((g) => (
                            <span key={g.id} className={g.ativo ? '' : 'opacity-50'} title={g.ativo ? undefined : 'Gatilho desligado'}>
                              <Chip>{rotuloCurto(g)}</Chip>
                            </span>
                          ))
                        )}
                        {gs.length > 4 && <Chip>+{gs.length - 4}</Chip>}
                      </div>

                      <div className="mt-3 text-[12.5px] text-[#C9DCD8]">
                        {f.execucoes_total} {f.execucoes_total === 1 ? 'pessoa entrou' : 'pessoas entraram'}
                        {taxa !== null && <span className="text-muted"> · {taxa}% chegaram ao fim</span>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted">Editado {haQuanto(f.atualizado_em)}</div>

                      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                        <Link href={`/automacoes/${f.id}`} className={btnPequeno}>
                          Abrir
                        </Link>
                        {f.status === 'ativo' ? (
                          <button type="button" disabled={ocupado === f.id} onClick={() => void mudarStatus(f, 'pausado')} className={btnPequeno}>
                            Pausar
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={ocupado === f.id}
                            onClick={() => void mudarStatus(f, 'ativo')}
                            className="rounded-lg border border-blue/50 bg-blue/15 px-2.5 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-blue/25 disabled:opacity-60"
                          >
                            {ocupado === f.id ? '…' : 'Ativar'}
                          </button>
                        )}
                        <button type="button" disabled={ocupado === f.id} onClick={() => void duplicar(f)} className={btnPequeno}>
                          Duplicar
                        </button>
                        <span className="ml-auto">
                          <ApagarInline onConfirmar={() => apagar(f)} />
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {modal && <NovoFluxoModal onFechar={() => setModal(false)} />}
    </div>
  );
}
