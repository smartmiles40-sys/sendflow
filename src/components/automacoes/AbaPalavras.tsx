'use client';

import { useMemo, useState } from 'react';
import { casaPalavraChave } from '@/lib/automacao/montar';
import type { GatilhoConfig } from '@/lib/automacao/tipos';
import { Field, inputCls, SegButton, Switch } from '@/components/ui';
import {
  api,
  ApagarInline,
  Aviso,
  AvisoFluxoInativo,
  btnPequeno,
  btnPrimario,
  btnSecundario,
  Cartao,
  Chip,
  SeletorFluxo,
  Vazio,
  type FluxoResumo,
  type GatilhoLinha,
  type PropsAba,
} from './comum';

type Modo = NonNullable<GatilhoConfig['modo']>;

const MODOS: { id: Modo; rotulo: string; exemplo: string }[] = [
  { id: 'contem', rotulo: 'Contém a palavra', exemplo: '"quero ir pro Japão" dispara com japão' },
  { id: 'exata', rotulo: 'É exatamente', exemplo: 'só "japão", sozinho, dispara' },
  { id: 'comeca', rotulo: 'Começa com', exemplo: '"japão 2027" dispara; "oi, japão" não' },
];

/** Mesma ordem em que o motor testa: maior prioridade primeiro; empate, o mais antigo. */
function ordenar(gs: GatilhoLinha[]): GatilhoLinha[] {
  return [...gs].sort((a, b) => b.prioridade - a.prioridade || a.criado_em.localeCompare(b.criado_em));
}

export function AbaPalavras({ dados, recarregar }: PropsAba) {
  const lista = useMemo(() => ordenar(dados.gatilhos.filter((g) => g.tipo === 'palavra_chave')), [dados.gatilhos]);
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState('');

  async function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  /** Sobe/desce: renumera as prioridades da lista inteira para não haver empate. */
  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const nova = [...lista];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    const n = nova.length;
    const mudancas = nova
      .map((g, idx) => ({ g, prioridade: n - idx }))
      .filter(({ g, prioridade }) => g.prioridade !== prioridade);
    void rodar(() =>
      Promise.all(mudancas.map(({ g, prioridade }) => api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { prioridade } }))),
    );
  }

  // O teste roda a mesma função do motor, na mesma ordem: o que aparece aqui é o que
  // aconteceria de verdade (desde que o fluxo e o gatilho estejam ligados).
  const resultado = useMemo(() => {
    if (!teste.trim()) return null;
    const casados = lista.filter((g) => casaPalavraChave(teste, g.config));
    return { primeiro: casados.find((g) => g.ativo && g.fluxos?.status === 'ativo') ?? null, casados };
  }, [teste, lista]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
            Quando a pessoa escreve (ou clica num botão de template com) uma destas palavras, o fluxo começa. Acento,
            maiúscula e pontuação não importam: <b className="text-ink">Japão!</b> = <b className="text-ink">japao</b>.
          </p>
          {editando !== 'novo' && (
            <button type="button" onClick={() => setEditando('novo')} className={`${btnPrimario} w-full sm:w-auto`}>
              + Nova palavra-chave
            </button>
          )}
        </div>

        {erro && (
          <div className="mb-4">
            <Aviso>{erro}</Aviso>
          </div>
        )}

        {editando === 'novo' && (
          <div className="mb-4">
            <FormPalavra
              fluxos={dados.fluxos}
              onCancelar={() => setEditando(null)}
              onSalvar={async (cfg, fluxoId) => {
                await api('/api/gatilhos', {
                  method: 'POST',
                  json: { tipo: 'palavra_chave', fluxo_id: fluxoId, config: cfg, prioridade: 0 },
                });
                await recarregar();
                setEditando(null);
              }}
            />
          </div>
        )}

        {lista.length === 0 && editando !== 'novo' ? (
          <Vazio>
            <p className="font-semibold text-ink">Nenhuma palavra-chave ainda.</p>
            <p className="mt-1">
              Exemplo: quem escrever <b className="text-ink">japão</b>, <b className="text-ink">peru</b> ou{' '}
              <b className="text-ink">orçamento</b> recebe na hora o fluxo certo, com botões — sem ninguém do time digitar.
            </p>
          </Vazio>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {lista.map((g, i) =>
              editando === g.id ? (
                <li key={g.id}>
                  <FormPalavra
                    fluxos={dados.fluxos}
                    inicial={g}
                    onCancelar={() => setEditando(null)}
                    onSalvar={async (cfg, fluxoId) => {
                      await api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { config: cfg, fluxo_id: fluxoId } });
                      await recarregar();
                      setEditando(null);
                    }}
                  />
                </li>
              ) : (
                <li
                  key={g.id}
                  className={`flex flex-col gap-3 rounded-xl2 border border-border bg-surface p-4 sm:flex-row sm:items-center ${g.ativo ? '' : 'opacity-70'}`}
                >
                  <div className="flex shrink-0 flex-row gap-1 sm:flex-col" aria-label="Ordem de prioridade">
                    <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className={btnPequeno} aria-label="Subir prioridade">
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === lista.length - 1}
                      className={btnPequeno}
                      aria-label="Descer prioridade"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-1.5">
                      {(g.config.palavras ?? []).map((p) => (
                        <Chip key={p}>{p}</Chip>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[12.5px] text-muted">
                      {MODOS.find((m) => m.id === (g.config.modo ?? 'contem'))?.rotulo} → <b className="text-ink">{g.fluxos?.nome ?? 'fluxo apagado'}</b>
                      {' · '}
                      {g.disparos} {g.disparos === 1 ? 'disparo' : 'disparos'}
                    </p>
                    <AvisoFluxoInativo g={g} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={g.ativo}
                      onChange={(v) => void rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { ativo: v } }))}
                      label="Ligar palavra-chave"
                    />
                    <button type="button" onClick={() => setEditando(g.id)} className={btnPequeno}>
                      Editar
                    </button>
                    <ApagarInline onConfirmar={() => rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'DELETE' }))} />
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <Cartao className="h-fit xl:sticky xl:top-4">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">Testar uma mensagem</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">Digite como o cliente escreveria e veja qual fluxo responderia.</p>
        <input
          value={teste}
          onChange={(e) => setTeste(e.target.value)}
          placeholder="ex.: quanto custa o Japão?"
          className={`${inputCls} mt-3`}
          aria-label="Mensagem de teste"
        />
        {resultado && (
          <div className="mt-3 text-[13px]">
            {resultado.primeiro ? (
              <p className="text-[#bfeec9]">
                ✓ Responderia o fluxo <b className="text-ink">{resultado.primeiro.fluxos?.nome}</b>
              </p>
            ) : resultado.casados.length ? (
              <p className="text-[#ffb183]">Casou, mas o gatilho ou o fluxo está desligado — ninguém responderia.</p>
            ) : (
              <p className="text-muted">Nenhuma palavra-chave casou. Vale a boas-vindas (se for a 1ª mensagem) ou a resposta padrão.</p>
            )}
            {resultado.casados.length > 1 && (
              <p className="mt-1.5 text-[12px] text-muted">
                {resultado.casados.length} palavras-chave casaram; vale a de cima da lista. Use ▲▼ para mudar.
              </p>
            )}
          </div>
        )}
      </Cartao>
    </div>
  );
}

function FormPalavra({
  fluxos,
  inicial,
  onSalvar,
  onCancelar,
}: {
  fluxos: FluxoResumo[];
  inicial?: GatilhoLinha;
  onSalvar: (cfg: GatilhoConfig, fluxoId: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [palavras, setPalavras] = useState<string[]>(inicial?.config.palavras ?? []);
  const [digitando, setDigitando] = useState('');
  const [modo, setModo] = useState<Modo>(inicial?.config.modo ?? 'contem');
  const [fluxoId, setFluxoId] = useState(inicial?.fluxo_id ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function adicionar(texto: string) {
    const novas = texto
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!novas.length) return;
    setPalavras((atual) => [...new Set([...atual, ...novas])]);
    setDigitando('');
  }

  async function salvar() {
    const todas = digitando.trim() ? [...new Set([...palavras, ...digitando.split(',').map((p) => p.trim()).filter(Boolean)])] : palavras;
    if (!todas.length) return setErro('Escreva pelo menos uma palavra.');
    if (!fluxoId) return setErro('Escolha qual fluxo vai responder.');
    setOcupado(true);
    setErro(null);
    try {
      await onSalvar({ palavras: todas, modo }, fluxoId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  return (
    <Cartao className="border-blue2/40">
      <Field label="Palavras" hint="· Enter ou vírgula para separar; variações ajudam (japão, japao, japan)">
        <div className="flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface2 px-2.5 py-2 focus-within:border-blue2">
          {palavras.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 rounded-full bg-blue2/15 py-0.5 pl-2.5 pr-1 text-[12.5px] text-[#DFEFC5]">
              {p}
              <button
                type="button"
                onClick={() => setPalavras((a) => a.filter((x) => x !== p))}
                className="rounded-full px-1 text-muted hover:text-ink"
                aria-label={`Remover ${p}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={digitando}
            onChange={(e) => (e.target.value.includes(',') ? adicionar(e.target.value) : setDigitando(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                adicionar(digitando);
              } else if (e.key === 'Backspace' && !digitando && palavras.length) {
                setPalavras((a) => a.slice(0, -1));
              }
            }}
            placeholder={palavras.length ? '' : 'japão, japao, japan'}
            className="min-w-[120px] flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
            autoFocus
            aria-label="Nova palavra"
          />
        </div>
      </Field>
      <Field label="Como comparar">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODOS.map((m) => (
            <SegButton key={m.id} on={modo === m.id} onClick={() => setModo(m.id)}>
              {m.rotulo}
            </SegButton>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-muted">{MODOS.find((m) => m.id === modo)?.exemplo}</p>
      </Field>
      <Field label="Fluxo que responde">
        <SeletorFluxo fluxos={fluxos} valor={fluxoId} onChange={setFluxoId} />
      </Field>
      {erro && (
        <div className="mb-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={() => void salvar()} disabled={ocupado} className={`${btnPrimario} flex-1 sm:flex-none`}>
          {ocupado ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancelar} className={btnSecundario}>
          Cancelar
        </button>
      </div>
    </Cartao>
  );
}
