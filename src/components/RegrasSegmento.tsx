'use client';

// O montador de regras de segmento: "contatos que [todas|qualquer] destas condições".
// Serve a tela de Contatos e o público das campanhas de e-mail. As opções (listas,
// tags, campos, campanhas) vêm de fora para o componente não sair buscando sozinho.

import {
  CAMPOS,
  condicaoPadrao,
  definicaoDoCampo,
  operador,
  STATUS_EMAIL,
  STATUS_WHATSAPP,
  type CampoSegmento,
  type Condicao,
  type Regras,
} from '@/lib/segmentos';
import { inputCls } from './ui';

export interface OpcoesSegmento {
  listas: { id: string; nome: string }[];
  tags: string[];
  campos: { chave: string; rotulo: string }[];
  campanhas: { id: string; nome: string }[];
}

const selectCls = `${inputCls} !py-2.5 text-[13px]`;

export function RegrasSegmento({
  regras,
  onChange,
  opcoes,
}: {
  regras: Regras;
  onChange: (r: Regras) => void;
  opcoes: OpcoesSegmento;
}) {
  // A tela só monta um nível; grupos aninhados são coisa do servidor.
  const condicoes = regras.condicoes.filter((c): c is Condicao => !('condicoes' in c));

  function trocar(i: number, c: Condicao) {
    onChange({ ...regras, condicoes: condicoes.map((x, j) => (j === i ? c : x)) });
  }
  function remover(i: number) {
    onChange({ ...regras, condicoes: condicoes.filter((_, j) => j !== i) });
  }

  const grupos = [...new Set(CAMPOS.map((c) => c.grupo))];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Contatos que atendem a
        <select
          value={regras.combinar}
          onChange={(e) => onChange({ ...regras, combinar: e.target.value === 'qualquer' ? 'qualquer' : 'todas' })}
          className={`${selectCls} !w-auto`}
          aria-label="Como combinar as condições"
        >
          <option value="todas">todas as condições (E)</option>
          <option value="qualquer">qualquer condição (OU)</option>
        </select>
      </div>

      {condicoes.map((c, i) => {
        const def = definicaoDoCampo(c.campo);
        const oper = operador(c.campo, c.op);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface2/40 p-2.5">
            {i > 0 && (
              <span className="w-full text-[10px] font-semibold uppercase tracking-[0.12em] text-muted sm:w-auto">
                {regras.combinar === 'todas' ? 'e' : 'ou'}
              </span>
            )}
            <select
              value={c.campo}
              onChange={(e) => trocar(i, condicaoPadrao(e.target.value as CampoSegmento))}
              className={`${selectCls} min-w-[160px] flex-1 sm:flex-none`}
              aria-label="Campo"
            >
              {grupos.map((g) => (
                <optgroup key={g} label={g}>
                  {CAMPOS.filter((x) => x.grupo === g).map((x) => (
                    <option key={x.campo} value={x.campo}>
                      {x.rotulo}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {c.campo === 'campo' && (
              <select
                value={c.chave ?? ''}
                onChange={(e) => trocar(i, { ...c, chave: e.target.value })}
                className={`${selectCls} min-w-[140px] flex-1 sm:flex-none`}
                aria-label="Qual campo"
              >
                <option value="">Escolha o campo…</option>
                {opcoes.campos.map((f) => (
                  <option key={f.chave} value={f.chave}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            )}

            <select
              value={c.op}
              onChange={(e) => {
                const novo = operador(c.campo, e.target.value);
                trocar(i, { ...c, op: e.target.value, valor: novo?.valor === 'dias' ? c.valor || '30' : novo?.valor === oper?.valor ? c.valor : '' });
              }}
              className={`${selectCls} min-w-[160px] flex-1 sm:flex-none`}
              aria-label="Regra"
            >
              {def?.ops.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.rotulo}
                </option>
              ))}
            </select>

            <Valor condicao={c} tipo={oper?.valor ?? 'nenhum'} opcoes={opcoes} onChange={(valor) => trocar(i, { ...c, valor })} />

            <button
              type="button"
              onClick={() => remover(i)}
              aria-label="Remover condição"
              className="ml-auto rounded-lg border border-border px-2.5 py-2 text-xs text-muted transition-colors hover:border-[#ffb183]/40 hover:text-[#ffb183]"
            >
              ✕
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => onChange({ ...regras, condicoes: [...condicoes, condicaoPadrao()] })}
        className="self-start rounded-xl border border-dashed border-border px-3.5 py-2 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
      >
        ＋ Condição
      </button>
    </div>
  );
}

function Valor({
  condicao,
  tipo,
  opcoes,
  onChange,
}: {
  condicao: Condicao;
  tipo: string;
  opcoes: OpcoesSegmento;
  onChange: (v: string) => void;
}) {
  const v = condicao.valor ?? '';
  const cls = `${selectCls} min-w-[160px] flex-1`;
  switch (tipo) {
    case 'nenhum':
      return null;
    case 'dias':
      return (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <input
            value={v}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric"
            className={`${selectCls} !w-20`}
            aria-label="Dias"
          />
          dias
        </span>
      );
    case 'numero':
      return (
        <input
          value={v}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
          inputMode="decimal"
          className={`${selectCls} !w-28`}
          aria-label="Número"
        />
      );
    case 'tag':
      return (
        <>
          <input value={v} onChange={(e) => onChange(e.target.value.toLowerCase())} list="tags-segmento" placeholder="tag" className={cls} aria-label="Tag" />
          <datalist id="tags-segmento">
            {opcoes.tags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </>
      );
    case 'lista':
      return (
        <select value={v} onChange={(e) => onChange(e.target.value)} className={cls} aria-label="Lista">
          <option value="">Escolha a lista…</option>
          {opcoes.listas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
      );
    case 'campanha':
      return (
        <select value={v} onChange={(e) => onChange(e.target.value)} className={cls} aria-label="Campanha">
          <option value="">Escolha a campanha…</option>
          {opcoes.campanhas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      );
    case 'status_email':
    case 'status_whatsapp':
      return (
        <select value={v} onChange={(e) => onChange(e.target.value)} className={cls} aria-label="Situação">
          <option value="">Escolha…</option>
          {(tipo === 'status_email' ? STATUS_EMAIL : STATUS_WHATSAPP).map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.rotulo}
            </option>
          ))}
        </select>
      );
    default:
      return <input value={v} onChange={(e) => onChange(e.target.value)} placeholder="valor" className={cls} aria-label="Valor" />;
  }
}
