'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Campaign, CampaignStatus, CampaignType } from '@/lib/types';
import { campaignActions, type CampaignAction } from '@/lib/campaign-actions';
import { StatusChip } from './StatusChip';
import { formatWhen } from '@/lib/format';
import { categoriaLabel } from '@/lib/categories';

const typeIcon: Record<CampaignType, string> = {
  texto: '💬',
  imagem: '🖼️',
  video: '🎬',
  pdf: '📄',
  enquete: '📊',
};

const typeLabel: Record<CampaignType, string> = {
  texto: 'Só texto',
  imagem: 'Imagem + texto',
  video: 'Vídeo + legenda',
  pdf: 'PDF + texto',
  enquete: 'Enquete',
};

// Small muted line under the date, derived from status (no live "relative time"
// so server and client render identically — avoids hydration drift).
const whenHint: Record<CampaignStatus, string> = {
  rascunho: 'não agendada',
  agendada: 'agendada',
  enviando: 'em andamento',
  enviada: 'concluída',
  cancelada: 'cancelada',
  erro: 'falhou',
};

const actionMeta: Record<Exclude<CampaignAction, 'editar'>, { icon: string; label: string }> = {
  reenviar: { icon: '↻', label: 'Reenviar' },
  cancelar: { icon: '✕', label: 'Cancelar' },
  excluir: { icon: '🗑', label: 'Excluir' },
};

export type ActionResult = { ok: boolean; error?: string };

export function CampaignRow({
  c,
  onDelete,
  onCancel,
  onReenviar,
}: {
  c: Campaign;
  onDelete: (id: string) => Promise<ActionResult>;
  onCancel: (id: string) => Promise<ActionResult>;
  onReenviar: (id: string) => Promise<ActionResult>;
}) {
  const detail =
    c.status === 'enviando' && c.resultado
      ? `${c.resultado.enviados}/${c.resultado.total}`
      : undefined;

  const meta = typeLabel[c.tipo] + (c.mencionar_todos ? ' · menção a todos' : '');
  const actions = campaignActions(c.status);

  const [busy, setBusy] = useState<CampaignAction | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run(action: Exclude<CampaignAction, 'editar'>) {
    if (busy) return;
    setBusy(action);
    // On success for delete the row unmounts, so no state reset needed there.
    if (action === 'excluir') await onDelete(c.id);
    else if (action === 'cancelar') await onCancel(c.id);
    else if (action === 'reenviar') await onReenviar(c.id);
    setBusy(null);
    setConfirming(false);
  }

  return (
    <div className="grid grid-cols-[2.4fr_1.3fr_1fr_0.85fr_1.15fr] items-center gap-3 border-t border-border px-[18px] py-[15px] first:border-t-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-border bg-surface2 text-base">
          {typeIcon[c.tipo]}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={`/campanhas/${c.id}`} className="truncate text-sm font-semibold hover:underline">
              {c.nome}
            </Link>
            <span className="shrink-0 rounded-full border border-border bg-surface2 px-2 py-0.5 text-[11px] font-medium text-muted">
              {categoriaLabel(c.categoria)}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">{meta}</div>
        </div>
      </div>

      <div className="text-sm">
        {formatWhen(c.enviar_em)}
        <span className="mt-0.5 block text-xs text-muted">{whenHint[c.status]}</span>
      </div>

      <div className="min-w-0 text-sm text-ink">
        {publicoDaCampanha(c)}
      </div>

      <div>
        <StatusChip status={c.status} detail={detail} />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/campanhas/${c.id}`}
          aria-label={`Resultados de ${c.nome}`}
          title="Ver quem recebeu, quem leu e quem respondeu"
          className={iconBtnCls}
        >
          📊
        </Link>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Excluir?</span>
            <button
              type="button"
              onClick={() => void run('excluir')}
              disabled={busy !== null}
              className="rounded-lg border border-orange/40 bg-orange/[0.12] px-2.5 py-1 text-xs font-semibold text-[#ffb183] transition-colors hover:bg-orange/20 disabled:opacity-50"
            >
              {busy === 'excluir' ? '…' : 'Sim'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Não
            </button>
          </div>
        ) : (
          actions.map((a) =>
            a === 'editar' ? (
              <Link
                key={a}
                href={`/campanhas/nova?id=${c.id}`}
                aria-label={`Editar ${c.nome}`}
                title="Editar"
                className={iconBtnCls}
              >
                ✏️
              </Link>
            ) : (
              <button
                key={a}
                type="button"
                onClick={() => (a === 'excluir' ? setConfirming(true) : void run(a))}
                disabled={busy !== null}
                aria-label={`${actionMeta[a].label} ${c.nome}`}
                title={actionMeta[a].label}
                className={iconBtnCls}
              >
                {busy === a ? '…' : actionMeta[a].icon}
              </button>
            ),
          )
        )}
      </div>
    </div>
  );
}

/**
 * Descreve o público REAL da campanha.
 *
 * A versão anterior escrevia "Todos · grupos ativos" em toda linha, fosse qual fosse o
 * alvo — uma campanha mandada para dois grupos escolhidos a dedo aparecia na lista como
 * se tivesse ido para todo mundo. Rótulo fixo em coluna de dado é pior que coluna
 * vazia: parece informação.
 */
function publicoDaCampanha(c: Campaign): React.ReactNode {
  if (c.alvo === 'contatos') {
    const n = c.list_ids?.length ?? 0;
    return (
      <>
        Contatos <span className="text-xs text-muted">· {n} lista{n === 1 ? '' : 's'}</span>
      </>
    );
  }
  if (c.group_ids?.length) {
    return (
      <>
        {c.group_ids.length} grupo{c.group_ids.length === 1 ? '' : 's'}{' '}
        <span className="text-xs text-muted">· escolhidos</span>
      </>
    );
  }
  if (c.audience_id) {
    return (
      <>
        Público <span className="text-xs text-muted">· salvo</span>
      </>
    );
  }
  return (
    <>
      Todos <span className="text-xs text-muted">· grupos ativos</span>
    </>
  );
}

const iconBtnCls =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-border bg-surface2 text-sm text-muted transition-colors hover:border-blue2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue2 disabled:cursor-not-allowed disabled:opacity-50';
