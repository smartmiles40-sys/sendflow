import type { Veredicto } from '@/lib/kpis';

/**
 * Indicador numérico. A forma certa quando o dado é UM número — desenhar um gráfico
 * para um valor único só adiciona tinta sem adicionar informação.
 *
 * O selo de estado (bom/atenção/ruim) nunca é só a cor: vem sempre com o rótulo por
 * escrito. Quem não distingue verde de vermelho lê a palavra, e a informação chega igual.
 */

const ESTILO_VEREDICTO: Record<Exclude<Veredicto, 'indefinido'>, { label: string; cls: string }> = {
  bom: { label: 'bom', cls: 'bg-[color:var(--color-bom)]/15 text-[#6ee06e]' },
  ok: { label: 'ok', cls: 'bg-blue2/15 text-[#DFEFC5]' },
  atencao: { label: 'atenção', cls: 'bg-[color:var(--color-atencao)]/15 text-[#ffd479]' },
  ruim: { label: 'abaixo do esperado', cls: 'bg-[color:var(--color-critico)]/15 text-[#ff9a9a]' },
};

export function Tile({
  label,
  valor,
  apoio,
  veredicto,
  destaque,
}: {
  label: string;
  valor: string;
  /** Linha de contexto: de onde saiu o número, ou o denominador. */
  apoio?: string;
  veredicto?: Veredicto;
  destaque?: boolean;
}) {
  const estado = veredicto && veredicto !== 'indefinido' ? ESTILO_VEREDICTO[veredicto] : null;

  return (
    <div
      className={`rounded-xl2 border p-[18px] ${
        destaque ? 'border-blue2/40 bg-gradient-to-b from-blue/15 to-blue/5' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
        {estado && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${estado.cls}`}>
            {estado.label}
          </span>
        )}
      </div>
      <div className="mt-2 font-display text-[26px] font-semibold leading-tight tabular-nums">{valor}</div>
      {apoio && <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{apoio}</div>}
    </div>
  );
}
