'use client';

import { useEffect, useState } from 'react';
import { inputCls } from '@/components/ui';
import type { WhatsAppTemplate } from '@/lib/types';
import type { DadosTemplate } from '@/lib/automacao/tipos';
import { labelCls, miniBtn, Secao, Selecao, TextoVar } from './campos';
import { buscarTemplates, type Recursos } from './recursos';

function botoesRapidos(t: WhatsAppTemplate | undefined): string[] {
  return ((t?.botoes ?? []) as { type?: string; text?: string }[])
    .filter((b) => String(b.type).toUpperCase() === 'QUICK_REPLY' && b.text)
    .map((b) => String(b.text));
}

export function EditorTemplate({
  dados,
  mudar,
  rec,
  conexaoDoFluxo,
}: {
  dados: DadosTemplate;
  mudar: (d: DadosTemplate) => void;
  rec: Recursos;
  conexaoDoFluxo: string | null;
}) {
  const d = dados;
  const [conexao, setConexao] = useState<string>('');
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  const conexaoEfetiva = conexao || conexaoDoFluxo || rec.conexoes.find((c) => c.status === 'conectada')?.id || rec.conexoes[0]?.id || '';

  useEffect(() => {
    if (!conexaoEfetiva) return;
    let vivo = true;
    void buscarTemplates(conexaoEfetiva).then((t) => vivo && setTemplates(t));
    return () => {
      vivo = false;
    };
  }, [conexaoEfetiva]);

  const aprovados = (templates ?? []).filter((t) => t.status === 'APPROVED');
  const atual = (templates ?? []).find((t) => t.nome === d.nome && t.idioma === d.idioma);
  const nVars = atual?.variaveis_corpo ?? Object.keys(d.variaveis).length;
  const temMidia = atual?.cabecalho_tipo && atual.cabecalho_tipo !== 'TEXT';

  function escolher(chave: string) {
    const t = aprovados.find((x) => `${x.nome}|${x.idioma}` === chave);
    if (!t) return mudar({ ...d, nome: '', variaveis: {}, botoes: [] });
    const variaveis: Record<string, string> = {};
    for (let i = 1; i <= t.variaveis_corpo; i += 1) variaveis[String(i)] = d.variaveis[String(i)] ?? (i === 1 ? '{{primeiro_nome}}' : '');
    mudar({ ...d, nome: t.nome, idioma: t.idioma, variaveis, botoes: botoesRapidos(t), cabecalhoUrl: t.cabecalho_tipo && t.cabecalho_tipo !== 'TEXT' ? d.cabecalhoUrl ?? '' : null });
  }

  const previa = atual ? atual.corpo.replace(/\{\{(\d+)\}\}/g, (_, n: string) => d.variaveis[n] || `{{${n}}}`) : '';

  return (
    <>
      <Secao
        titulo="Template aprovado"
        dica="Fora da janela de 24 h (quem não te escreveu no último dia), só template aprovado pela Meta pode sair. Use no começo de fluxos de webhook, sequências e reengajamento."
      >
        {rec.conexoes.length > 1 && (
          <>
            <label className={labelCls}>Templates de qual número</label>
            <Selecao valor={conexaoEfetiva} onChange={setConexao} rotulo="Número" className="mb-3">
              {rec.conexoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} {c.numero ? `(+${c.numero})` : ''}
                </option>
              ))}
            </Selecao>
          </>
        )}
        {rec.carregado && !rec.conexoes.length && (
          <p className="mb-3 text-[12px] text-[#ffb183]">Nenhum número oficial conectado. Conecte em Conexões primeiro.</p>
        )}

        <label className={labelCls}>Template</label>
        <Selecao valor={d.nome ? `${d.nome}|${d.idioma}` : ''} onChange={escolher} rotulo="Template">
          <option value="">{templates === null ? 'Carregando…' : aprovados.length ? 'Escolha…' : 'Nenhum template aprovado'}</option>
          {aprovados.map((t) => (
            <option key={`${t.nome}|${t.idioma}`} value={`${t.nome}|${t.idioma}`}>
              {t.nome} · {t.idioma} · {t.categoria}
            </option>
          ))}
          {d.nome && !atual && <option value={`${d.nome}|${d.idioma}`}>{d.nome} (não encontrado)</option>}
        </Selecao>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className={miniBtn}
            disabled={!conexaoEfetiva || buscando}
            onClick={async () => {
              setBuscando(true);
              setTemplates(await buscarTemplates(conexaoEfetiva, true));
              setBuscando(false);
            }}
          >
            {buscando ? 'Buscando…' : '↻ Buscar templates na Meta'}
          </button>
          <span className="text-[11px] text-muted">Templates são criados e aprovados no Business Manager.</span>
        </div>

        {atual && (
          <div className="mt-3 rounded-xl bg-[#0b141a] p-3">
            <div className="rounded-lg bg-[#1f2c34] px-2.5 py-2 text-[12px] leading-snug text-[#e9edef] whitespace-pre-wrap">{previa}</div>
            {(d.botoes ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-col gap-1">
                {(d.botoes ?? []).map((b) => (
                  <div key={b} className="rounded-md bg-[#1f2c34] py-1 text-center text-[12px] text-[#53bdeb]">
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Secao>

      {nVars > 0 && (
        <Secao titulo="Variáveis" dica="O que entra em cada {{n}} do template, para cada pessoa.">
          {Array.from({ length: nVars }, (_, i) => String(i + 1)).map((n) => (
            <TextoVar
              key={n}
              rotulo={`{{${n}}}`}
              valor={d.variaveis[n] ?? ''}
              onChange={(v) => mudar({ ...d, variaveis: { ...d.variaveis, [n]: v } })}
              max={1024}
              linhas={1}
              variaveis={rec.campos}
            />
          ))}
        </Secao>
      )}

      {temMidia && (
        <Secao titulo={`Mídia do cabeçalho (${atual?.cabecalho_tipo?.toLowerCase()})`}>
          <input
            value={d.cabecalhoUrl ?? ''}
            onChange={(e) => mudar({ ...d, cabecalhoUrl: e.target.value.trim() })}
            placeholder="https://…"
            className={`${inputCls} py-2.5`}
          />
        </Secao>
      )}

      {(d.botoes ?? []).length > 0 && (
        <Secao titulo="Botões de resposta rápida">
          <p className="text-[11px] leading-relaxed text-muted">
            Cada botão do template virou uma saída no bloco. Se você ligar algum botão, o fluxo <b className="text-ink">espera o clique</b> e a
            saída <b className="text-ink">Depois de enviar</b> não é seguida.
          </p>
        </Secao>
      )}
    </>
  );
}
