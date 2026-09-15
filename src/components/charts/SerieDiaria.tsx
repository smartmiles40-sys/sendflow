'use client';

import { useMemo, useState } from 'react';
import type { KpiDiario } from '@/lib/types';
import { formatarNumero } from '@/lib/kpis';

/**
 * Série diária dos dois canais.
 *
 * Decisões de leitura, todas deliberadas:
 *
 * • UM EIXO SÓ. WhatsApp e e-mail compartilham a mesma escala porque medem a mesma
 *   coisa (mensagens). Dois eixos Y no mesmo gráfico é o erro clássico de painel:
 *   a posição relativa das duas linhas passa a depender de duas escalas escolhidas
 *   à mão, e dá para "provar" qualquer conclusão só mexendo nelas.
 * • LEGENDA SEMPRE, mais rótulo na ponta de cada linha. Identidade nunca depende
 *   só da cor — quem não distingue azul de laranja continua lendo o gráfico.
 * • RÓTULO SÓ NA PONTA. Número em cima de cada ponto vira ruído e ninguém lê; o
 *   valor de cada dia está no tooltip e na tabela.
 * • SEM BIBLIOTECA. São duas linhas em SVG. Trazer uma biblioteca de gráficos para
 *   isso custaria centenas de KB no navegador de quem só quer ver o número.
 */

export type Metrica = 'enviados' | 'entregues' | 'engajados' | 'acoes';

const SERIES = [
  { canal: 'whatsapp' as const, label: 'WhatsApp', cor: 'var(--color-serie-1)' },
  { canal: 'email' as const, label: 'E-mail', cor: 'var(--color-serie-2)' },
];

/** O nome da métrica muda por canal: "lido" no WhatsApp é "aberto" no e-mail. */
export const ROTULO_METRICA: Record<Metrica, { titulo: string; whatsapp: string; email: string }> = {
  enviados: { titulo: 'Enviados', whatsapp: 'mensagens enviadas', email: 'e-mails enviados' },
  entregues: { titulo: 'Entregues', whatsapp: 'chegaram no aparelho', email: 'aceitos pelo servidor' },
  engajados: { titulo: 'Lidos / abertos', whatsapp: 'mensagens lidas', email: 'e-mails abertos' },
  acoes: { titulo: 'Respostas / cliques', whatsapp: 'responderam', email: 'clicaram em um link' },
};

const L = 44; // margem esquerda: espaço dos rótulos do eixo Y
const R = 62; // margem direita: espaço do rótulo na ponta da linha
const T = 14;
const B = 26;
const LARGURA = 760;
const ALTURA = 240;

export function SerieDiaria({ serie, metrica }: { serie: KpiDiario[]; metrica: Metrica }) {
  const [foco, setFoco] = useState<number | null>(null);

  const dados = useMemo(() => montar(serie, metrica), [serie, metrica]);

  if (!dados.dias.length) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted">
        Nenhum envio no período. O gráfico aparece assim que a primeira campanha sair.
      </div>
    );
  }

  const { dias, linhas, maximo } = dados;
  const x = (i: number) =>
    dias.length === 1 ? L + (LARGURA - L - R) / 2 : L + (i * (LARGURA - L - R)) / (dias.length - 1);
  const y = (v: number) => T + (ALTURA - T - B) * (1 - v / maximo);

  const ticks = ticksDoEixo(maximo);

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {SERIES.map((s) => (
          <span key={s.canal} className="flex items-center gap-2 text-xs font-medium text-muted">
            <span className="h-[3px] w-4 rounded-full" style={{ background: s.cor }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        className="w-full"
        style={{ height: ALTURA }}
        role="img"
        aria-label={`${ROTULO_METRICA[metrica].titulo} por dia, WhatsApp e e-mail`}
        onMouseLeave={() => setFoco(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          // Converte o pixel do mouse para a coordenada do viewBox antes de achar o
          // ponto mais próximo — sem isso o foco erra quanto mais largo for o painel.
          const px = ((e.clientX - box.left) / box.width) * LARGURA;
          const passo = dias.length === 1 ? 1 : (LARGURA - L - R) / (dias.length - 1);
          const i = Math.round((px - L) / passo);
          setFoco(i >= 0 && i < dias.length ? i : null);
        }}
      >
        {/* Grade: 1px, sólida, recuada. Ela orienta; não compete com os dados. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={LARGURA - R} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">
              {formatarNumero(t)}
            </text>
          </g>
        ))}

        {/* Primeiro e último dia bastam: um rótulo por dia viraria uma tarja preta. */}
        <text x={L} y={ALTURA - 8} className="fill-muted text-[11px]">
          {formatarDia(dias[0])}
        </text>
        {dias.length > 1 && (
          <text x={LARGURA - R} y={ALTURA - 8} textAnchor="end" className="fill-muted text-[11px]">
            {formatarDia(dias[dias.length - 1])}
          </text>
        )}

        {foco !== null && (
          <line
            x1={x(foco)}
            x2={x(foco)}
            y1={T}
            y2={ALTURA - B}
            stroke="var(--color-blue2)"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        )}

        {SERIES.map((s) => {
          const valores = linhas[s.canal];
          if (!valores.some((v) => v > 0)) return null;
          const d = valores.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(v)}`).join(' ');
          const ultimo = valores.length - 1;
          return (
            <g key={s.canal}>
              <path
                d={d}
                fill="none"
                stroke={s.cor}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {/* Ponto final com anel na cor da superfície: as duas linhas podem
                  terminar juntas, e o anel é o que as mantém legíveis. */}
              <circle cx={x(ultimo)} cy={y(valores[ultimo])} r="4.5" fill={s.cor} stroke="var(--color-surface)" strokeWidth="2" />
              <text
                x={x(ultimo) + 10}
                y={y(valores[ultimo]) + 4}
                className="fill-ink text-[11px] font-semibold tabular-nums"
              >
                {formatarNumero(valores[ultimo])}
              </text>
              {foco !== null && (
                <circle cx={x(foco)} cy={y(valores[foco])} r="4.5" fill={s.cor} stroke="var(--color-surface)" strokeWidth="2" />
              )}
            </g>
          );
        })}
      </svg>

      {foco !== null && (
        <Tooltip
          dia={dias[foco]}
          whatsapp={linhas.whatsapp[foco]}
          email={linhas.email[foco]}
          // Segue o ponto na horizontal, mas sem sair do painel nas pontas.
          esquerda={`${Math.min(88, Math.max(12, (x(foco) / LARGURA) * 100))}%`}
        />
      )}
    </div>
  );
}

function Tooltip({
  dia,
  whatsapp,
  email,
  esquerda,
}: {
  dia: string;
  whatsapp: number;
  email: number;
  esquerda: string;
}) {
  return (
    <div
      className="pointer-events-none absolute top-8 z-10 -translate-x-1/2 rounded-xl border border-border bg-surface2 px-3 py-2 text-xs shadow-[0_12px_32px_rgba(0,0,0,.55)]"
      style={{ left: esquerda }}
    >
      <div className="mb-1.5 font-semibold text-ink">{formatarDiaLongo(dia)}</div>
      <div className="flex items-center gap-2 text-muted">
        <span className="h-[3px] w-3 rounded-full" style={{ background: 'var(--color-serie-1)' }} />
        WhatsApp <b className="tabular-nums text-ink">{formatarNumero(whatsapp)}</b>
      </div>
      <div className="flex items-center gap-2 text-muted">
        <span className="h-[3px] w-3 rounded-full" style={{ background: 'var(--color-serie-2)' }} />
        E-mail <b className="tabular-nums text-ink">{formatarNumero(email)}</b>
      </div>
    </div>
  );
}

/**
 * Transforma as linhas do banco (uma por dia POR CANAL, e só nos dias em que houve
 * envio) numa grade completa de dias.
 *
 * Preencher os dias vazios com zero é o que impede a mentira visual: sem isso, dois
 * envios separados por uma semana viram uma reta contínua, como se tivesse havido
 * atividade no meio.
 */
function montar(serie: KpiDiario[], metrica: Metrica) {
  const dias = [...new Set(serie.map((s) => s.dia))].sort();
  const grade = preencherDias(dias);
  const indice = new Map(grade.map((d, i) => [d, i]));

  const linhas = {
    whatsapp: new Array<number>(grade.length).fill(0),
    email: new Array<number>(grade.length).fill(0),
  };
  for (const linha of serie) {
    const i = indice.get(linha.dia);
    if (i === undefined) continue;
    linhas[linha.canal][i] = Number(linha[metrica] ?? 0);
  }

  const maximo = Math.max(1, ...linhas.whatsapp, ...linhas.email);
  return { dias: grade, linhas, maximo };
}

/** Todos os dias entre o primeiro e o último, inclusive os sem envio. */
function preencherDias(dias: string[]): string[] {
  if (dias.length <= 1) return dias;
  const saida: string[] = [];
  const fim = new Date(`${dias[dias.length - 1]}T12:00:00Z`).getTime();
  for (let t = new Date(`${dias[0]}T12:00:00Z`).getTime(); t <= fim; t += 86_400_000) {
    saida.push(new Date(t).toISOString().slice(0, 10));
    if (saida.length > 400) break; // trava contra intervalo absurdo
  }
  return saida;
}

/** Marcas do eixo Y em números redondos (0 / 500 / 1.000), nunca 0 / 337 / 674. */
function ticksDoEixo(maximo: number): number[] {
  const alvo = 4;
  const bruto = maximo / alvo;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((p) => p >= bruto) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= maximo + passo * 0.001; v += passo) ticks.push(Math.round(v));
  return ticks;
}

function formatarDia(dia: string): string {
  const [, m, d] = dia.split('-');
  return `${d}/${m}`;
}

function formatarDiaLongo(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}
