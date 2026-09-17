'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { EmailCampaign, EmailCampaignStatus, EmailKpi } from '@/lib/types';
import { formatWhen } from '@/lib/format';
import { avaliar, formatarNumero, formatarTaxa, REFERENCIAS } from '@/lib/kpis';

type Linha = EmailCampaign & { kpi: EmailKpi | null };

const ESTILO: Record<EmailCampaignStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  rascunho: { label: 'Rascunho', cls: 'bg-muted/15 text-[#C9DCD8]', dot: 'bg-muted' },
  agendada: { label: 'Agendada', cls: 'bg-blue2/15 text-[#DFEFC5]', dot: 'bg-blue2' },
  enviando: { label: 'Enviando…', cls: 'bg-orange/15 text-[#ffb183]', dot: 'bg-orange', pulse: true },
  enviada: { label: 'Enviada', cls: 'bg-green/10 text-[#D7F264]', dot: 'bg-green' },
  cancelada: { label: 'Cancelada', cls: 'bg-muted/15 text-muted', dot: 'bg-muted' },
  erro: { label: 'Erro', cls: 'bg-orange/15 text-[#ffb183]', dot: 'bg-orange' },
};

const ABAS = [
  { key: 'ativas', label: 'Agendadas e em envio' },
  { key: 'enviadas', label: 'Enviadas' },
  { key: 'rascunhos', label: 'Rascunhos' },
] as const;

const FILTRO: Record<(typeof ABAS)[number]['key'], (s: EmailCampaignStatus) => boolean> = {
  ativas: (s) => s === 'agendada' || s === 'enviando',
  enviadas: (s) => s === 'enviada' || s === 'erro' || s === 'cancelada',
  rascunhos: (s) => s === 'rascunho',
};

export function EmailListaClient({
  campanhas,
  provedor,
}: {
  campanhas: Linha[];
  provedor: string | null;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<(typeof ABAS)[number]['key']>('enviadas');
  const [erro, setErro] = useState<string | null>(null);

  const linhas = useMemo(() => campanhas.filter((c) => FILTRO[aba](c.status)), [campanhas, aba]);

  // Média das campanhas que já saíram — a referência interna vale mais que qualquer
  // benchmark de mercado, porque é o mesmo público.
  const media = useMemo(() => {
    const enviadas = campanhas.filter((c) => c.kpi && c.kpi.enviados > 0);
    if (!enviadas.length) return null;
    const soma = enviadas.reduce(
      (acc, c) => ({
        entregues: acc.entregues + (c.kpi?.entregues ?? 0),
        abriram: acc.abriram + (c.kpi?.abriram ?? 0),
        clicaram: acc.clicaram + (c.kpi?.clicaram ?? 0),
        enviados: acc.enviados + (c.kpi?.enviados ?? 0),
      }),
      { entregues: 0, abriram: 0, clicaram: 0, enviados: 0 },
    );
    return {
      campanhas: enviadas.length,
      enviados: soma.enviados,
      abertura: soma.entregues ? Math.round((soma.abriram / soma.entregues) * 1000) / 10 : null,
      clique: soma.entregues ? Math.round((soma.clicaram / soma.entregues) * 1000) / 10 : null,
    };
  }, [campanhas]);

  async function cancelar(c: Linha) {
    if (!window.confirm(`Interromper o envio de "${c.nome}"? O que já saiu não volta.`)) return;
    const res = await fetch(`/api/email/campaigns/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelada' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setErro(body.error ?? 'Não foi possível cancelar.');
    else router.refresh();
  }

  async function excluir(c: Linha) {
    if (!window.confirm(`Excluir "${c.nome}"? Os resultados dela também somem.`)) return;
    const res = await fetch(`/api/email/campaigns/${c.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setErro(body.error ?? 'Não foi possível excluir.');
    else router.refresh();
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">
            Campanhas de e-mail
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Escreva, agende e acompanhe abertura, clique, bounce e descadastro de cada envio.
          </p>
        </div>
        <Link
          href="/email/nova"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-blue px-[18px] py-3 text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover"
        >
          ＋ Nova campanha
        </Link>
      </div>

      {!provedor && (
        <div
          role="alert"
          className="mb-6 rounded-xl2 border border-orange/30 bg-orange/[0.08] p-5 text-sm leading-relaxed text-[#ffb183]"
        >
          <strong className="font-semibold">Envio de e-mail desligado.</strong> Configure{' '}
          <code className="font-mono text-xs">RESEND_API_KEY</code> (recomendado) ou as variáveis{' '}
          <code className="font-mono text-xs">SMTP_*</code>. Dá para escrever e salvar rascunhos
          normalmente enquanto isso.
        </div>
      )}

      {media && (
        <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Cartao label="Campanhas enviadas" valor={formatarNumero(media.campanhas)} />
          <Cartao label="E-mails enviados" valor={formatarNumero(media.enviados)} />
          <Cartao
            label="Abertura média"
            valor={formatarTaxa(media.abertura)}
            veredicto={avaliar(media.abertura, REFERENCIAS.email_abertura)}
          />
          <Cartao
            label="Clique médio"
            valor={formatarTaxa(media.clique)}
            veredicto={avaliar(media.clique, REFERENCIAS.email_clique)}
          />
        </div>
      )}

      <div className="mb-3.5 flex gap-1.5 border-b border-border">
        {ABAS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setAba(t.key)}
            aria-pressed={aba === t.key}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              aba === t.key ? 'border-blue text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {erro && (
        <div role="alert" className="mb-3.5 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]">
          {erro}
        </div>
      )}

      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {linhas.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            {aba === 'enviadas'
              ? 'Nada enviado ainda. O que sair aparece aqui com os números de abertura e clique.'
              : aba === 'ativas'
                ? 'Nenhuma campanha agendada.'
                : 'Sem rascunhos salvos.'}
          </p>
        ) : (
          <div className="divide-y divide-border">
            {linhas.map((c) => (
              <LinhaCampanha
                key={c.id}
                c={c}
                onCancelar={() => void cancelar(c)}
                onExcluir={() => void excluir(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinhaCampanha({
  c,
  onCancelar,
  onExcluir,
}: {
  c: Linha;
  onCancelar: () => void;
  onExcluir: () => void;
}) {
  const estilo = ESTILO[c.status];
  const editavel = c.status === 'rascunho' || c.status === 'agendada' || c.status === 'cancelada';
  const interrompivel = c.status === 'agendada' || c.status === 'enviando';
  const k = c.kpi;

  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href={`/email/${c.id}`} className="truncate text-sm font-semibold hover:underline">
            {c.nome}
          </Link>
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${estilo.cls}`}
          >
            <span className={`h-[7px] w-[7px] rounded-full ${estilo.dot} ${estilo.pulse ? 'animate-chip-pulse' : ''}`} />
            {estilo.label}
          </span>
          {c.assunto_b && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted">
              teste A/B
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-muted">{c.assunto || 'Sem assunto'}</div>

        <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-muted">
          <span>{formatWhen(c.enviado_em ?? c.enviar_em)}</span>
          {k && k.enviados > 0 && (
            <>
              <span>{formatarNumero(k.enviados)} enviados</span>
              <span>
                <b className="text-ink">{formatarTaxa(k.taxa_abertura)}</b> abriram
              </span>
              <span>{formatarTaxa(k.taxa_clique)} clicaram</span>
              {k.bounces > 0 && <span className="text-[#ffb183]">{formatarNumero(k.bounces)} bounces</span>}
              {k.pendentes > 0 && <span>{formatarNumero(k.pendentes)} na fila</span>}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Link
          href={`/email/${c.id}`}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
        >
          Resultados
        </Link>
        {editavel && (
          <Link
            href={`/email/${c.id}/editar`}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
          >
            Editar
          </Link>
        )}
        {interrompivel && (
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted transition-colors hover:border-[#ffb183]/40 hover:text-[#ffb183]"
          >
            Interromper
          </button>
        )}
        {c.status !== 'enviando' && (
          <button
            type="button"
            onClick={onExcluir}
            aria-label={`Excluir ${c.nome}`}
            className="rounded-lg border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-[#ffb183]/40 hover:text-[#ffb183]"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

function Cartao({
  label,
  valor,
  veredicto,
}: {
  label: string;
  valor: string;
  veredicto?: ReturnType<typeof avaliar>;
}) {
  const cor =
    veredicto === 'bom'
      ? 'text-[#6ee06e]'
      : veredicto === 'ruim'
        ? 'text-[#ff9a9a]'
        : veredicto === 'atencao'
          ? 'text-[#ffd479]'
          : '';
  return (
    <div className="rounded-xl2 border border-border bg-surface p-[18px]">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={`mt-2 font-display text-[26px] font-semibold leading-tight tabular-nums ${cor}`}>
        {valor}
      </div>
    </div>
  );
}
