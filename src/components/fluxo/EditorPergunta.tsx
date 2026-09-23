'use client';

import { inputCls } from '@/components/ui';
import { LIMITES, type DadosPergunta, type TipoResposta } from '@/lib/automacao/tipos';
import { Contador, labelCls, miniBtn, Numero, perigoBtn, Secao, Selecao, TextoVar } from './campos';
import type { Recursos } from './recursos';

const TIPOS: { v: TipoResposta; rotulo: string; dica: string }[] = [
  { v: 'texto', rotulo: 'Texto', dica: 'Aceita qualquer texto.' },
  { v: 'email', rotulo: 'E-mail', dica: 'Confere o formato (nome@dominio.com).' },
  { v: 'telefone', rotulo: 'Telefone', dica: 'Aceita com ou sem DDD e guarda com +55.' },
  { v: 'numero', rotulo: 'Número', dica: 'Aceita 3, 3,5 ou 1.200.' },
  { v: 'data', rotulo: 'Data', dica: 'Aceita 15/03 ou 15/03/2027.' },
  { v: 'qualquer', rotulo: 'Qualquer coisa', dica: 'Aceita até foto ou áudio (guarda o texto, se houver).' },
];

export function EditorPergunta({
  dados,
  mudar,
  rec,
}: {
  dados: DadosPergunta;
  mudar: (d: DadosPergunta) => void;
  rec: Recursos;
}) {
  const d = dados;
  const set = (p: Partial<DadosPergunta>) => mudar({ ...d, ...p });
  const sugestoes = d.sugestoes ?? [];
  const tipo = TIPOS.find((t) => t.v === d.tipoResposta);

  return (
    <>
      <Secao titulo="Pergunta">
        <TextoVar
          valor={d.pergunta}
          onChange={(pergunta) => set({ pergunta })}
          max={sugestoes.length ? LIMITES.textoInterativo : LIMITES.texto}
          placeholder="Qual é o seu melhor e-mail?"
          linhas={3}
          variaveis={rec.campos}
        />
        <label className={labelCls}>Sugestões de resposta em botão (opcional)</label>
        <div className="flex flex-col gap-1.5">
          {sugestoes.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={s}
                onChange={(e) => set({ sugestoes: sugestoes.map((x, j) => (j === i ? e.target.value : x)) })}
                className={`${inputCls} py-2`}
                placeholder={`Sugestão ${i + 1}`}
              />
              <Contador valor={s} max={LIMITES.tituloBotao} />
              <button type="button" className={perigoBtn} onClick={() => set({ sugestoes: sugestoes.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className={`${miniBtn} self-start`}
            disabled={sugestoes.length >= LIMITES.botoes}
            onClick={() => set({ sugestoes: [...sugestoes, ''] })}
          >
            + Sugestão ({sugestoes.length}/{LIMITES.botoes})
          </button>
          <p className="text-[11px] text-muted">A pessoa pode clicar numa sugestão ou digitar outra resposta.</p>
        </div>
      </Secao>

      <Secao titulo="Resposta" dica="O fluxo espera a pessoa responder. Resposta fora do formato pede de novo.">
        <label className={labelCls}>Tipo de resposta</label>
        <Selecao valor={d.tipoResposta} onChange={(v) => set({ tipoResposta: v as TipoResposta })} rotulo="Tipo de resposta">
          {TIPOS.map((t) => (
            <option key={t.v} value={t.v}>
              {t.rotulo}
            </option>
          ))}
        </Selecao>
        {tipo && <p className="mb-3 mt-1 text-[11px] text-muted">{tipo.dica}</p>}

        <label className={labelCls}>Guardar a resposta em</label>
        <Selecao valor={d.salvarEm ?? ''} onChange={(v) => set({ salvarEm: v || null })} rotulo="Guardar em">
          <option value="">— não guardar</option>
          <option value="nome">Nome do contato</option>
          <option value="email">E-mail do contato</option>
          {rec.campos.length > 0 && (
            <optgroup label="Campos personalizados">
              {rec.campos.map((c) => (
                <option key={c.chave} value={c.chave}>
                  {c.rotulo} ({c.chave})
                </option>
              ))}
            </optgroup>
          )}
        </Selecao>
        <p className="mb-3 mt-1 text-[11px] text-muted">
          Falta um campo? Crie em <b className="text-ink">Automações → Campos</b>.
        </p>

        <TextoVar
          rotulo="Mensagem quando a resposta é inválida"
          valor={d.mensagemErro ?? ''}
          onChange={(mensagemErro) => set({ mensagemErro })}
          max={LIMITES.texto}
          linhas={2}
          semVariaveis
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Tentativas</label>
            <Numero valor={d.tentativas ?? 2} min={1} max={10} onChange={(tentativas) => set({ tentativas: Math.max(1, tentativas) })} />
          </div>
          <div>
            <label className={labelCls}>Prazo (min)</label>
            <Numero valor={d.esperarMinutos ?? 0} min={0} onChange={(esperarMinutos) => set({ esperarMinutos: Math.max(0, esperarMinutos) })} />
          </div>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          Prazo 0 = espera para sempre. Esgotadas as tentativas (ou o prazo), segue por <b className="text-ink">Não respondeu / inválido</b>.
        </p>
      </Secao>
    </>
  );
}
