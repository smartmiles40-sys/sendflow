'use client';

// O painel da direita: edita o bloco selecionado. No celular vira uma folha que sobe
// de baixo, cobrindo metade da tela — o canvas continua visível em cima.

import Link from 'next/link';
import { inputCls } from '@/components/ui';
import { ROTULO_TIPO, type No, type ProblemaGrafo } from '@/lib/automacao/tipos';
import { ICONE, DESCRICAO_TIPO } from './contexto';
import { EditorMensagem } from './EditorMensagem';
import { EditorPergunta } from './EditorPergunta';
import { EditorTemplate } from './EditorTemplate';
import { EditorAguardar, EditorCondicao, EditorIrPara, EditorRandomizador } from './EditorLogica';
import { EditorAcoes } from './EditorAcoes';
import { Secao } from './campos';
import type { Recursos } from './recursos';

export function Painel({
  no,
  mudar,
  fechar,
  rec,
  problemas,
  fluxoId,
  conexaoDoFluxo,
}: {
  no: No;
  mudar: (no: No) => void;
  fechar: () => void;
  rec: Recursos;
  problemas: ProblemaGrafo[];
  fluxoId: string;
  conexaoDoFluxo: string | null;
}) {
  // Cada editor recebe só os dados do seu tipo; aqui o bloco inteiro é remontado.
  const set = (dados: unknown) => mudar({ ...no, dados } as No);

  return (
    <aside
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col rounded-t-2xl border-t border-border bg-surface shadow-[0_-20px_50px_rgba(0,0,0,.45)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[380px] md:rounded-none md:border-l md:border-t-0"
      aria-label="Editar bloco"
    >
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <span className="mt-1 text-lg" aria-hidden="true">
          {ICONE[no.tipo]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{ROTULO_TIPO[no.tipo]}</div>
          {no.tipo === 'inicio' ? (
            <div className="text-[15px] font-semibold text-ink">Início</div>
          ) : (
            <input
              value={no.titulo ?? ''}
              onChange={(e) => mudar({ ...no, titulo: e.target.value.slice(0, 60) } as No)}
              placeholder={`Nome do bloco (ex.: ${ROTULO_TIPO[no.tipo]})`}
              className={`${inputCls} mt-1 py-1.5 text-[14px] font-semibold`}
              aria-label="Nome do bloco"
            />
          )}
          <p className="mt-1 text-[11px] text-muted">{DESCRICAO_TIPO[no.tipo]}</p>
        </div>
        <button
          type="button"
          onClick={fechar}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:text-ink"
          aria-label="Fechar painel"
        >
          ✕
        </button>
      </div>

      {problemas.length > 0 && (
        <ul className="border-b border-border bg-orange/[0.06] px-4 py-2.5 text-[12px] leading-relaxed">
          {problemas.map((p, i) => (
            <li key={i} className={p.grave ? 'text-[#ffb183]' : 'text-[#fab219]'}>
              {p.grave ? '● ' : '○ '}
              {p.mensagem}
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {no.tipo === 'inicio' && (
          <Secao titulo="Como este fluxo começa">
            <p className="text-[13px] leading-relaxed text-muted">
              O Início não tem conteúdo: quem decide QUANDO o fluxo começa são os <b className="text-ink">gatilhos</b> — palavra-chave,
              mensagem de boas-vindas, link wa.me, anúncio, tag ou webhook da LP.
            </p>
            <Link href="/automacoes" className="mt-3 inline-block text-[13px] font-semibold text-[#D7F264] underline underline-offset-2">
              Gerenciar gatilhos em Automações →
            </Link>
          </Secao>
        )}
        {no.tipo === 'mensagem' && <EditorMensagem dados={no.dados} mudar={set} rec={rec} />}
        {no.tipo === 'pergunta' && <EditorPergunta dados={no.dados} mudar={set} rec={rec} />}
        {no.tipo === 'template' && <EditorTemplate dados={no.dados} mudar={set} rec={rec} conexaoDoFluxo={conexaoDoFluxo} />}
        {no.tipo === 'aguardar' && <EditorAguardar dados={no.dados} mudar={set} />}
        {no.tipo === 'condicao' && <EditorCondicao dados={no.dados} mudar={set} rec={rec} />}
        {no.tipo === 'acao' && <EditorAcoes dados={no.dados} mudar={set} rec={rec} />}
        {no.tipo === 'randomizador' && <EditorRandomizador dados={no.dados} mudar={set} />}
        {no.tipo === 'ir_para' && <EditorIrPara dados={no.dados} mudar={set} rec={rec} fluxoAtual={fluxoId} />}
        {no.tipo === 'fim' && (
          <Secao titulo="Fim">
            <p className="text-[13px] text-muted">
              Encerra o fluxo para esta pessoa. Opcional: uma saída sem seta também encerra — o Fim só deixa isso explícito no desenho.
            </p>
          </Secao>
        )}
      </div>
    </aside>
  );
}
