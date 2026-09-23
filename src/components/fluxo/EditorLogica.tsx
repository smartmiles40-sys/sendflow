'use client';

import { inputCls, SegButton } from '@/components/ui';
import {
  novoId,
  type CampoCondicao,
  type DadosAguardar,
  type DadosCondicao,
  type DadosIrPara,
  type DadosRandomizador,
  type OperadorCondicao,
  type Regra,
  type UnidadeTempo,
} from '@/lib/automacao/tipos';
import { labelCls, miniBtn, Numero, perigoBtn, Secao, Selecao } from './campos';
import type { Recursos } from './recursos';

// ── Aguardar ─────────────────────────────────────────────────────────────────────

export function EditorAguardar({ dados, mudar }: { dados: DadosAguardar; mudar: (d: DadosAguardar) => void }) {
  const d = dados;
  const comJanela = Boolean(d.janelaInicio && d.janelaFim);
  return (
    <Secao titulo="Quanto esperar" dica="O fluxo para aqui e segue sozinho quando o tempo acabar — mesmo dias depois.">
      <div className="flex gap-2">
        <Numero valor={d.quantidade} min={1} onChange={(quantidade) => mudar({ ...d, quantidade: Math.max(1, quantidade) })} className="w-24" />
        <Selecao valor={d.unidade} onChange={(v) => mudar({ ...d, unidade: v as UnidadeTempo })} rotulo="Unidade">
          <option value="minutos">minutos</option>
          <option value="horas">horas</option>
          <option value="dias">dias</option>
        </Selecao>
      </div>

      <label className="mt-4 flex items-center gap-2 text-[13px] text-ink">
        <input
          type="checkbox"
          checked={comJanela}
          onChange={(e) =>
            mudar(e.target.checked ? { ...d, janelaInicio: '09:00', janelaFim: '20:00' } : { ...d, janelaInicio: null, janelaFim: null })
          }
          className="h-4 w-4 accent-[#D7F264]"
        />
        Só seguir dentro de um horário
      </label>
      {comJanela && (
        <div className="mt-2 flex items-center gap-2">
          <input type="time" value={d.janelaInicio ?? ''} onChange={(e) => mudar({ ...d, janelaInicio: e.target.value })} className={`${inputCls} py-2`} />
          <span className="text-muted">até</span>
          <input type="time" value={d.janelaFim ?? ''} onChange={(e) => mudar({ ...d, janelaFim: e.target.value })} className={`${inputCls} py-2`} />
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Horário de São Paulo. Se a espera terminar fora da faixa, a mensagem sai na próxima abertura — ninguém recebe nada às 3h da manhã.
      </p>
      {d.unidade === 'dias' || (d.unidade === 'horas' && d.quantidade >= 24) ? (
        <p className="mt-2 rounded-lg border border-[#fab219]/30 bg-[#fab219]/[0.07] px-2.5 py-1.5 text-[11px] leading-relaxed text-[#fab219]">
          Depois de 24 h sem a pessoa responder, a janela fecha: o próximo bloco precisa ser um <b>Template</b> (ou ligue a saída “Janela de 24 h fechada”).
        </p>
      ) : null}
    </Secao>
  );
}

// ── Condição ─────────────────────────────────────────────────────────────────────

const CAMPOS: { v: CampoCondicao; rotulo: string }[] = [
  { v: 'tag', rotulo: 'Tag' },
  { v: 'campo', rotulo: 'Campo personalizado' },
  { v: 'nome', rotulo: 'Nome' },
  { v: 'email', rotulo: 'E-mail' },
  { v: 'telefone', rotulo: 'Telefone' },
  { v: 'janela_aberta', rotulo: 'Janela de 24 h aberta' },
  { v: 'inscrito_whatsapp', rotulo: 'Inscrito no WhatsApp' },
];

function operadoresDe(campo: CampoCondicao): { v: OperadorCondicao; rotulo: string }[] {
  if (campo === 'tag') return [
    { v: 'tem', rotulo: 'tem a tag' },
    { v: 'nao_tem', rotulo: 'não tem a tag' },
  ];
  if (campo === 'janela_aberta' || campo === 'inscrito_whatsapp') return [
    { v: 'tem', rotulo: 'sim' },
    { v: 'nao_tem', rotulo: 'não' },
  ];
  return [
    { v: 'igual', rotulo: 'é igual a' },
    { v: 'diferente', rotulo: 'é diferente de' },
    { v: 'contem', rotulo: 'contém' },
    { v: 'nao_contem', rotulo: 'não contém' },
    { v: 'preenchido', rotulo: 'está preenchido' },
    { v: 'vazio', rotulo: 'está vazio' },
    { v: 'maior', rotulo: 'é maior que' },
    { v: 'menor', rotulo: 'é menor que' },
  ];
}

export function EditorCondicao({
  dados,
  mudar,
  rec,
}: {
  dados: DadosCondicao;
  mudar: (d: DadosCondicao) => void;
  rec: Recursos;
}) {
  const d = dados;
  const setRegra = (i: number, r: Regra) => mudar({ ...d, regras: d.regras.map((x, j) => (j === i ? r : x)) });
  return (
    <Secao titulo="Regras" dica="Se as regras baterem, a pessoa segue por Sim; senão, por Não.">
      <div className="mb-3 flex gap-1.5">
        <SegButton on={d.combinar === 'todas'} onClick={() => mudar({ ...d, combinar: 'todas' })}>
          Todas (E)
        </SegButton>
        <SegButton on={d.combinar === 'qualquer'} onClick={() => mudar({ ...d, combinar: 'qualquer' })}>
          Qualquer (OU)
        </SegButton>
      </div>
      <div className="flex flex-col gap-2">
        {d.regras.map((r, i) => {
          const ops = operadoresDe(r.campo);
          const semValor = r.campo === 'janela_aberta' || r.campo === 'inscrito_whatsapp' || r.operador === 'vazio' || r.operador === 'preenchido';
          return (
            <div key={i} className="rounded-xl border border-border bg-surface2/60 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase text-muted">{i === 0 ? 'Se' : d.combinar === 'todas' ? 'E' : 'Ou'}</span>
                <button type="button" className={perigoBtn} onClick={() => mudar({ ...d, regras: d.regras.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
              <Selecao
                valor={r.campo}
                onChange={(v) => {
                  const campo = v as CampoCondicao;
                  setRegra(i, { campo, operador: operadoresDe(campo)[0].v, valor: '', chave: campo === 'campo' ? rec.campos[0]?.chave : undefined });
                }}
                rotulo="Campo"
                className="mb-1.5"
              >
                {CAMPOS.map((c) => (
                  <option key={c.v} value={c.v}>
                    {c.rotulo}
                  </option>
                ))}
              </Selecao>
              {r.campo === 'campo' && (
                <Selecao valor={r.chave ?? ''} onChange={(chave) => setRegra(i, { ...r, chave })} rotulo="Qual campo" className="mb-1.5">
                  <option value="">Escolha o campo…</option>
                  {rec.campos.map((c) => (
                    <option key={c.chave} value={c.chave}>
                      {c.rotulo}
                    </option>
                  ))}
                </Selecao>
              )}
              <Selecao valor={r.operador} onChange={(v) => setRegra(i, { ...r, operador: v as OperadorCondicao })} rotulo="Operador" className="mb-1.5">
                {ops.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.rotulo}
                  </option>
                ))}
              </Selecao>
              {!semValor && (
                <input
                  value={r.valor ?? ''}
                  onChange={(e) => setRegra(i, { ...r, valor: e.target.value })}
                  placeholder={r.campo === 'tag' ? 'nome da tag' : 'valor'}
                  className={`${inputCls} py-2`}
                />
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={`${miniBtn} mt-2`}
        onClick={() => mudar({ ...d, regras: [...d.regras, { campo: 'tag', operador: 'tem', valor: '' }] })}
      >
        + Regra
      </button>
      <p className="mt-2 text-[11px] text-muted">Maiúsculas e acentos não importam: “Japão” = “japao”.</p>
    </Secao>
  );
}

// ── Teste A/B ────────────────────────────────────────────────────────────────────

export function EditorRandomizador({ dados, mudar }: { dados: DadosRandomizador; mudar: (d: DadosRandomizador) => void }) {
  const d = dados;
  const total = d.variantes.reduce((s, v) => s + (v.peso > 0 ? v.peso : 0), 0);
  return (
    <Secao titulo="Caminhos" dica="Cada pessoa cai num caminho sorteado pelo peso. Compare os números em cima de cada saída para ver qual converte mais.">
      <div className="flex flex-col gap-2">
        {d.variantes.map((v, i) => (
          <div key={v.id} className="flex items-center gap-1.5">
            <input
              value={v.nome}
              onChange={(e) => mudar({ variantes: d.variantes.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })}
              className={`${inputCls} py-2`}
              aria-label="Nome do caminho"
            />
            <Numero
              valor={v.peso}
              min={0}
              max={100}
              onChange={(peso) => mudar({ variantes: d.variantes.map((x, j) => (j === i ? { ...x, peso: Math.max(0, peso) } : x)) })}
              className="w-20"
            />
            <span className="w-10 text-right text-[11px] tabular-nums text-muted">{total ? Math.round((Math.max(0, v.peso) / total) * 100) : 0}%</span>
            <button
              type="button"
              className={perigoBtn}
              disabled={d.variantes.length <= 2}
              onClick={() => mudar({ variantes: d.variantes.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={`${miniBtn} mt-2`}
        disabled={d.variantes.length >= 6}
        onClick={() =>
          mudar({ variantes: [...d.variantes, { id: novoId('v'), nome: String.fromCharCode(65 + d.variantes.length), peso: 50 }] })
        }
      >
        + Caminho
      </button>
    </Secao>
  );
}

// ── Ir para outro fluxo ──────────────────────────────────────────────────────────

export function EditorIrPara({
  dados,
  mudar,
  rec,
  fluxoAtual,
}: {
  dados: DadosIrPara;
  mudar: (d: DadosIrPara) => void;
  rec: Recursos;
  fluxoAtual: string;
}) {
  const outros = rec.fluxos.filter((f) => f.id !== fluxoAtual);
  return (
    <Secao titulo="Continuar em" dica="Este fluxo termina aqui e a pessoa começa o fluxo escolhido, do Início. Bom para reaproveitar um menu ou uma captura de dados.">
      <label className={labelCls}>Fluxo</label>
      <Selecao valor={dados.fluxoId ?? ''} onChange={(v) => mudar({ fluxoId: v || null })} rotulo="Fluxo">
        <option value="">Escolha…</option>
        {outros.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nome} {f.status !== 'ativo' ? `(${f.status})` : ''}
          </option>
        ))}
      </Selecao>
      {dados.fluxoId && (
        <a href={`/automacoes/${dados.fluxoId}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12px] text-[#D7F264] underline underline-offset-2">
          Abrir esse fluxo ↗
        </a>
      )}
    </Secao>
  );
}
