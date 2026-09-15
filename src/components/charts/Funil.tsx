'use client';

import { formatarNumero, formatarTaxa, taxa } from '@/lib/kpis';

export interface EtapaFunil {
  rotulo: string;
  valor: number;
  /** O que a etapa significa em português claro, para quem não é de marketing. */
  explicacao: string;
}

/**
 * Funil de uma campanha: barras horizontais, do topo (enviados) para a base.
 *
 * Por que barras e não o desenho de "funil" com trapézios: o trapézio codifica o
 * valor na ÁREA, e a percepção de área é notoriamente ruim — uma etapa com metade do
 * valor não parece metade. Barras codificam em comprimento, que é a dimensão que o
 * olho lê com precisão. O visual clássico de funil é bonito e mente.
 *
 * A cor é ORDINAL (uma matiz, do claro ao escuro) porque as etapas têm ordem. Cores
 * categóricas aqui sugeririam que "entregue" e "lido" são coisas independentes, e não
 * dois pontos do mesmo caminho.
 */
const CORES = [
  'var(--color-funil-1)',
  'var(--color-funil-2)',
  'var(--color-funil-3)',
  'var(--color-funil-4)',
];

export function Funil({ etapas, titulo }: { etapas: EtapaFunil[]; titulo?: string }) {
  const base = etapas[0]?.valor ?? 0;

  if (!base) {
    return (
      <div className="rounded-xl border border-border bg-surface2 p-5 text-sm text-muted">
        Nada enviado ainda neste período.
      </div>
    );
  }

  return (
    <div>
      {titulo && (
        <h3 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{titulo}</h3>
      )}
      <div className="flex flex-col gap-2.5">
        {etapas.map((etapa, i) => {
          const largura = Math.max(0.6, (etapa.valor / base) * 100);
          const doTopo = taxa(etapa.valor, base);
          const anterior = i > 0 ? etapas[i - 1].valor : null;
          const daEtapaAnterior = anterior !== null ? taxa(etapa.valor, anterior) : null;

          return (
            <div key={etapa.rotulo} className="group">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold text-ink">{etapa.rotulo}</span>
                <span className="shrink-0 text-xs text-muted">
                  <b className="tabular-nums text-ink">{formatarNumero(etapa.valor)}</b>
                  {i > 0 && (
                    <>
                      {' · '}
                      {formatarTaxa(doTopo)} do total
                      {daEtapaAnterior !== null && daEtapaAnterior !== doTopo && (
                        <> · {formatarTaxa(daEtapaAnterior)} da etapa anterior</>
                      )}
                    </>
                  )}
                </span>
              </div>
              {/* Barra de no máximo 24px, ponta arredondada e quadrada na base:
                  todas nascem da mesma linha de partida à esquerda. */}
              <div className="h-4 w-full overflow-hidden rounded-[4px] bg-surface2">
                <div
                  className="h-full rounded-r-[4px] transition-[width] duration-500"
                  style={{ width: `${largura}%`, background: CORES[Math.min(i, CORES.length - 1)] }}
                />
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{etapa.explicacao}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
