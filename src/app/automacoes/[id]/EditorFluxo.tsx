'use client';

// O editor visual de um fluxo — o canvas do ManyChat.
//
// A fonte da verdade enquanto a tela está aberta são os nós e setas do React Flow
// (posição, medida, seleção). O `Grafo` que vai para o banco é DERIVADO deles na hora
// de salvar: cada nó carrega o bloco inteiro em `data.no`, e cada seta vira uma
// `Ligacao` (a saída é o `sourceHandle`). Assim não existem duas cópias do fluxo
// brigando — só uma, e uma função que a traduz.

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection as RFConnection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  novoId,
  noPadrao,
  ROTULO_GATILHO,
  ROTULO_TIPO,
  saidasDoNo,
  validarGrafo,
  type Fluxo,
  type Gatilho,
  type Grafo,
  type No,
  type TipoNo,
} from '@/lib/automacao/tipos';
import { inputCls } from '@/components/ui';
import { NoCard } from '@/components/fluxo/NoCard';
import { Painel } from '@/components/fluxo/Painel';
import { COR, Ctx, DESCRICAO_TIPO, ICONE, type DadosRF, type EditorCtx, type EstatNo } from '@/components/fluxo/contexto';
import { useRecursos } from '@/components/fluxo/recursos';

type NoRF = Node<DadosRF, 'bloco'>;

const TIPOS_NOVOS: TipoNo[] = ['mensagem', 'pergunta', 'template', 'aguardar', 'condicao', 'acao', 'randomizador', 'ir_para', 'fim'];

const nodeTypes = { bloco: NoCard };

// ── Conversões ───────────────────────────────────────────────────────────────────

function paraNoRF(no: No): NoRF {
  return {
    id: no.id,
    type: 'bloco',
    position: { x: no.x, y: no.y },
    data: { no },
    deletable: no.tipo !== 'inicio',
    dragHandle: undefined,
  };
}

function paraSeta(l: { id: string; de: string; saida: string; para: string }): Edge {
  return { id: l.id, source: l.de, sourceHandle: l.saida, target: l.para, targetHandle: 'in' };
}

function montarGrafo(nodes: NoRF[], edges: Edge[]): Grafo {
  return {
    nos: nodes.map((n) => ({ ...n.data.no, x: Math.round(n.position.x), y: Math.round(n.position.y) }) as No),
    ligacoes: edges.map((e) => ({ id: e.id, de: e.source, saida: e.sourceHandle ?? 'proximo', para: e.target })),
  };
}

type EstadoSalvo = 'salvo' | 'pendente' | 'salvando' | 'erro';

interface Execucao {
  id: string;
  estado: string;
  no_atual: string | null;
  erro: string | null;
  iniciada_em: string;
  acordar_em: string | null;
  wa_conversas: { wa_id: string; nome_perfil: string | null } | null;
}

const ESTADO_EXEC: Record<string, { rotulo: string; cls: string }> = {
  rodando: { rotulo: 'Rodando', cls: 'bg-blue/15 text-[#D7F264]' },
  aguardando_resposta: { rotulo: 'Esperando resposta', cls: 'bg-blue2/15 text-[#DFEFC5]' },
  aguardando_tempo: { rotulo: 'Esperando o tempo', cls: 'bg-[#fab219]/15 text-[#fab219]' },
  concluida: { rotulo: 'Concluiu', cls: 'bg-green/10 text-green' },
  cancelada: { rotulo: 'Cancelada', cls: 'bg-muted/15 text-muted' },
  erro: { rotulo: 'Erro', cls: 'bg-orange/15 text-[#ffb183]' },
};

const btn =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 py-2 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimario =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue px-3.5 py-2 text-[13px] font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-60';

export function EditorFluxo({ id }: { id: string }) {
  const [carga, setCarga] = useState<{ fluxo: Fluxo; gatilhos: Gatilho[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/fluxos/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) setErro(b.error ?? 'Não consegui abrir o fluxo.');
        else setCarga(b as { fluxo: Fluxo; gatilhos: Gatilho[] });
      })
      .catch(() => vivo && setErro('Sem conexão com o servidor.'));
    return () => {
      vivo = false;
    };
  }, [id]);

  return (
    <div className="-mx-4 -mb-8 h-[calc(100dvh-4rem)] md:-mx-9 md:-my-[30px] md:h-dvh">
      {erro ? (
        <div className="p-8">
          <p className="text-[#ffb183]">{erro}</p>
          <Link href="/automacoes" className="mt-3 inline-block text-sm text-[#D7F264] underline">
            ← Voltar para Automações
          </Link>
        </div>
      ) : !carga ? (
        <div className="flex h-full items-center justify-center text-sm text-muted">Abrindo o fluxo…</div>
      ) : (
        <ReactFlowProvider>
          <Editor fluxo={carga.fluxo} gatilhos={carga.gatilhos} />
        </ReactFlowProvider>
      )}
    </div>
  );
}

function Editor({ fluxo, gatilhos }: { fluxo: Fluxo; gatilhos: Gatilho[] }) {
  const rf = useReactFlow<NoRF, Edge>();
  const rec = useRecursos();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const grafoInicial = useMemo<Grafo>(
    () => ({ nos: fluxo.grafo?.nos ?? [], ligacoes: fluxo.grafo?.ligacoes ?? [] }),
    [fluxo.grafo],
  );
  const [nodes, setNodes] = useState<NoRF[]>(() => grafoInicial.nos.map(paraNoRF));
  const [edges, setEdges] = useState<Edge[]>(() => grafoInicial.ligacoes.map(paraSeta));
  const [nome, setNome] = useState(fluxo.nome);
  const [status, setStatus] = useState(fluxo.status);
  const [sel, setSel] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<EstadoSalvo>('salvo');
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [stats, setStats] = useState<Record<string, EstatNo>>({});
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [ativas, setAtivas] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; cx: number; cy: number; de?: string; saida?: string } | null>(null);
  const [gaveta, setGaveta] = useState<null | 'validacao' | 'gatilhos' | 'pessoas' | 'teste'>(null);
  const [problemasServidor, setProblemasServidor] = useState<{ noId: string | null; mensagem: string }[] | null>(null);
  const [mudandoStatus, setMudandoStatus] = useState(false);
  const [paleta, setPaleta] = useState(false);

  const sujar = useCallback(() => {
    setSalvo('pendente');
    setVersao((v) => v + 1);
  }, []);

  const grafo = useMemo(() => montarGrafo(nodes, edges), [nodes, edges]);
  const problemas = useMemo(() => validarGrafo(grafo), [grafo]);
  const graves = problemas.filter((p) => p.grave);

  // ── Salvar ─────────────────────────────────────────────────────────────────────
  // Os callbacks leem o estado mais recente por refs (atualizadas depois de cada
  // render), para não recriar tudo a cada tecla.
  const ultimo = useRef({ grafo, nome });
  const nodesRef = useRef(nodes);
  const selRef = useRef(sel);
  useLayoutEffect(() => {
    ultimo.current = { grafo, nome };
    nodesRef.current = nodes;
    selRef.current = sel;
  });

  const salvar = useCallback(async (): Promise<boolean> => {
    setSalvo('salvando');
    setErroSalvar(null);
    try {
      const r = await fetch(`/api/fluxos/${fluxo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grafo: ultimo.current.grafo, nome: ultimo.current.nome.trim() || 'Sem nome' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSalvo('erro');
        // Fluxo ATIVO com erro grave: o servidor recusa salvar. Sem modal aqui (o
        // salvamento é automático, a cada tecla) — a faixa e o botão de conferência avisam.
        setErroSalvar(
          b.problemas
            ? `Fluxo ativo com ${b.problemas.length} erro(s): corrija (botão ⚠ no topo) ou pause o fluxo para salvar.`
            : (b.error ?? 'Não salvou.'),
        );
        return false;
      }
      setSalvo('salvo');
      return true;
    } catch {
      setSalvo('erro');
      setErroSalvar('Sem conexão — as mudanças ainda não foram salvas.');
      return false;
    }
  }, [fluxo.id]);

  // Salvamento automático 1,5 s depois da última mudança.
  useEffect(() => {
    if (versao === 0) return;
    const t = setTimeout(() => void salvar(), 1500);
    return () => clearTimeout(t);
  }, [versao, salvar]);

  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (salvo === 'pendente' || salvo === 'salvando' || salvo === 'erro') e.preventDefault();
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [salvo]);

  // ── Estatísticas ───────────────────────────────────────────────────────────────
  const carregarStats = useCallback(async () => {
    try {
      const r = await fetch(`/api/fluxos/${fluxo.id}/estatisticas`, { cache: 'no-store' });
      if (!r.ok) return;
      const b = (await r.json()) as { nos?: Record<string, EstatNo>; execucoes?: Execucao[]; ativas?: number };
      setStats(b.nos ?? {});
      setExecucoes(b.execucoes ?? []);
      setAtivas(b.ativas ?? 0);
    } catch {
      /* sem números por enquanto */
    }
  }, [fluxo.id]);

  useEffect(() => {
    // Primeira leitura logo que abre; depois a cada 30 s.
    const primeira = setTimeout(() => void carregarStats(), 0);
    const t = setInterval(() => void carregarStats(), 30_000);
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [carregarStats]);

  // ── Mudanças no canvas ─────────────────────────────────────────────────────────
  const onNodesChange = useCallback(
    (changes: NodeChange<NoRF>[]) => {
      // O Início não sai, nem por tecla.
      const filtradas = changes.filter(
        (c) => !(c.type === 'remove' && nodesRef.current.find((n) => n.id === c.id)?.data.no.tipo === 'inicio'),
      );
      setNodes((ns) => applyNodeChanges(filtradas, ns));
      if (filtradas.some((c) => (c.type === 'position' && c.dragging === false) || c.type === 'remove')) sujar();
      if (filtradas.some((c) => c.type === 'remove' && c.id === selRef.current)) setSel(null);
    },
    [sujar],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type === 'remove')) sujar();
    },
    [sujar],
  );

  const onConnect = useCallback(
    (c: RFConnection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      // Uma saída leva a UM lugar: ligar de novo substitui a seta anterior.
      setEdges((es) =>
        addEdge(
          { ...c, id: novoId('l'), targetHandle: 'in' },
          es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle)),
        ),
      );
      sujar();
    },
    [sujar],
  );

  const abrirMenu = useCallback((cx: number, cy: number, de?: string, saida?: string) => {
    const caixa = wrapperRef.current?.getBoundingClientRect();
    if (!caixa) return;
    setMenu({
      x: Math.min(Math.max(8, cx - caixa.left), caixa.width - 250),
      y: Math.min(Math.max(8, cy - caixa.top), caixa.height - 360),
      cx,
      cy,
      de,
      saida,
    });
  }, []);

  // Soltar a seta no vazio: abre o menu de criar o bloco já ligado (igual ManyChat).
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, estado) => {
      if (estado.isValid || !estado.fromNode || !estado.fromHandle || estado.fromHandle.type !== 'source') return;
      const ponto = 'changedTouches' in event ? event.changedTouches[0] : event;
      abrirMenu(ponto.clientX, ponto.clientY, estado.fromNode.id, estado.fromHandle.id ?? 'proximo');
    },
    [abrirMenu],
  );

  const selecionar = useCallback((id: string | null) => {
    setSel(id);
    setNodes((ns) => ns.map((n) => (Boolean(n.selected) === (n.id === id) ? n : { ...n, selected: n.id === id })));
  }, []);

  const focar = useCallback(
    (id: string) => {
      selecionar(id);
      const n = nodesRef.current.find((x) => x.id === id);
      if (n) void rf.setCenter(n.position.x + 136, n.position.y + 80, { zoom: 1, duration: 400 });
    },
    [rf, selecionar],
  );

  const criarBloco = useCallback(
    (tipo: TipoNo, pos?: { x: number; y: number }, de?: string, saida?: string) => {
      let p = pos;
      if (!p) {
        const caixa = wrapperRef.current?.getBoundingClientRect();
        const centro = caixa ? { x: caixa.left + caixa.width / 2, y: caixa.top + caixa.height / 2 } : { x: 400, y: 300 };
        p = rf.screenToFlowPosition(centro);
        p = { x: p.x - 136 + ((nodesRef.current.length * 23) % 90), y: p.y - 60 + ((nodesRef.current.length * 31) % 90) };
      }
      const no = noPadrao(tipo, Math.round(p.x), Math.round(p.y));
      setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...paraNoRF(no), selected: true }]);
      if (de && saida) {
        setEdges((es) => [
          ...es.filter((e) => !(e.source === de && e.sourceHandle === saida)),
          { id: novoId('l'), source: de, sourceHandle: saida, target: no.id, targetHandle: 'in' },
        ]);
      }
      setSel(no.id);
      setMenu(null);
      setPaleta(false);
      sujar();
    },
    [rf, sujar],
  );

  const atualizarNo = useCallback(
    (no: No) => {
      setNodes((ns) => ns.map((n) => (n.id === no.id ? { ...n, data: { no } } : n)));
      // Saída que deixou de existir (botão apagado) leva a seta junto.
      const validas = new Set(saidasDoNo(no).map((s) => s.id));
      setEdges((es) => es.filter((e) => e.source !== no.id || validas.has(e.sourceHandle ?? 'proximo')));
      sujar();
    },
    [sujar],
  );

  const apagar = useCallback(
    (id: string) => {
      const n = nodesRef.current.find((x) => x.id === id);
      if (!n || n.data.no.tipo === 'inicio') return;
      setNodes((ns) => ns.filter((x) => x.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      if (selRef.current === id) setSel(null);
      sujar();
    },
    [sujar],
  );

  const duplicar = useCallback(
    (id: string) => {
      const n = nodesRef.current.find((x) => x.id === id);
      if (!n || n.data.no.tipo === 'inicio') return;
      const copia = JSON.parse(JSON.stringify(n.data.no)) as No;
      copia.id = novoId(copia.tipo.slice(0, 3));
      copia.x = Math.round(n.position.x + 40);
      copia.y = Math.round(n.position.y + 60);
      if (copia.titulo) copia.titulo = `${copia.titulo} (cópia)`;
      setNodes((ns) => [...ns.map((x) => (x.selected ? { ...x, selected: false } : x)), { ...paraNoRF(copia), selected: true }]);
      setSel(copia.id);
      sujar();
    },
    [sujar],
  );

  const saidasLigadas = useMemo(() => new Set(edges.map((e) => `${e.source}::${e.sourceHandle ?? 'proximo'}`)), [edges]);
  const comProblema = useMemo(() => new Set(graves.map((p) => p.noId).filter(Boolean) as string[]), [graves]);
  const nomeFluxo = useCallback((fid: string | null) => rec.fluxos.find((f) => f.id === fid)?.nome ?? null, [rec.fluxos]);

  const ctx = useMemo<EditorCtx>(
    () => ({
      stats,
      comProblema,
      selecionar,
      abrirMenuSaida: (noId, saida, cx, cy) => abrirMenu(cx, cy, noId, saida),
      saidasLigadas,
      duplicar,
      apagar,
      nomeFluxo,
    }),
    [stats, comProblema, selecionar, abrirMenu, saidasLigadas, duplicar, apagar, nomeFluxo],
  );

  // Setas: saída principal em lima, secundária (erro, prazo) tracejada e apagada.
  const secundarias = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) for (const x of saidasDoNo(n.data.no)) if (x.secundaria) s.add(`${n.id}::${x.id}`);
    return s;
  }, [nodes]);
  const setasVisiveis = useMemo(
    () =>
      edges.map((e) => {
        const sec = secundarias.has(`${e.source}::${e.sourceHandle}`);
        const cor = e.selected ? '#F8F6F7' : sec ? '#8FAEA9' : '#D7F264';
        return {
          ...e,
          style: { stroke: cor, strokeWidth: e.selected ? 3 : 2, strokeDasharray: sec ? '6 5' : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: cor, width: 18, height: 18 },
        };
      }),
    [edges, secundarias],
  );

  const noSel = nodes.find((n) => n.id === sel)?.data.no ?? null;

  // ── Status ─────────────────────────────────────────────────────────────────────
  async function mudarStatus(novo: 'ativo' | 'pausado') {
    setMudandoStatus(true);
    setProblemasServidor(null);
    try {
      const r = await fetch(`/api/fluxos/${fluxo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novo, grafo: ultimo.current.grafo, nome: ultimo.current.nome.trim() || 'Sem nome' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (b.problemas) setProblemasServidor(b.problemas);
        else setErroSalvar(b.error ?? 'Não consegui mudar o status.');
        return;
      }
      setStatus(novo);
      setSalvo('salvo');
    } finally {
      setMudandoStatus(false);
    }
  }

  const chipStatus =
    status === 'ativo'
      ? { t: '● Ativo', c: 'bg-green/10 text-green' }
      : status === 'pausado'
        ? { t: 'Pausado', c: 'bg-[#fab219]/15 text-[#fab219]' }
        : { t: 'Rascunho', c: 'bg-muted/15 text-muted' };

  const textoSalvo = { salvo: 'Salvo', pendente: 'Alterações…', salvando: 'Salvando…', erro: 'Não salvou' }[salvo];

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full flex-col">
        {/* ── Barra do topo ── */}
        <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2.5 md:px-4">
          <Link href="/automacoes" className="rounded-lg px-2 py-1.5 text-sm text-muted hover:text-ink" title="Voltar para Automações">
            ←
          </Link>
          <input
            value={nome}
            onChange={(e) => {
              setNome(e.target.value.slice(0, 120));
              sujar();
            }}
            className="min-w-[140px] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 font-display text-[19px] text-ink outline-none hover:border-border focus:border-blue2 md:max-w-[360px]"
            aria-label="Nome do fluxo"
          />
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chipStatus.c}`}>{chipStatus.t}</span>
          <span
            className={`text-xs ${salvo === 'erro' ? 'text-[#ffb183]' : 'text-muted'}`}
            title={erroSalvar ?? undefined}
            aria-live="polite"
          >
            {textoSalvo}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className={`${btn} ${graves.length ? '!border-orange/50 !text-[#ffb183]' : ''}`}
              onClick={() => setGaveta(gaveta === 'validacao' ? null : 'validacao')}
            >
              {graves.length ? `⚠ ${graves.length} para corrigir` : problemas.length ? `○ ${problemas.length} avisos` : '✓ Tudo certo'}
            </button>
            <button type="button" className={btn} onClick={() => setGaveta(gaveta === 'gatilhos' ? null : 'gatilhos')}>
              ⚡ Gatilhos ({gatilhos.length})
            </button>
            <button type="button" className={btn} onClick={() => setGaveta(gaveta === 'pessoas' ? null : 'pessoas')}>
              👥 No fluxo ({ativas})
            </button>
            <button type="button" className={btn} onClick={() => setGaveta('teste')}>
              📱 Testar
            </button>
            <button type="button" className={btn} onClick={() => void salvar()} disabled={salvo === 'salvando'}>
              Salvar
            </button>
            {status === 'ativo' ? (
              <button type="button" className={btn} onClick={() => void mudarStatus('pausado')} disabled={mudandoStatus}>
                ⏸ Pausar
              </button>
            ) : (
              <button type="button" className={btnPrimario} onClick={() => void mudarStatus('ativo')} disabled={mudandoStatus}>
                {mudandoStatus ? 'Ativando…' : '▶ Ativar'}
              </button>
            )}
          </div>
        </header>

        {erroSalvar && salvo === 'erro' && !problemasServidor && (
          <div className="border-b border-orange/25 bg-orange/[0.07] px-4 py-1.5 text-xs text-[#ffb183]" role="alert">
            {erroSalvar}{' '}
            <button type="button" className="underline" onClick={() => void salvar()}>
              Tentar de novo
            </button>
          </div>
        )}

        <div className="relative flex min-h-0 flex-1">
          {/* ── Paleta ── */}
          <nav
            className={`absolute left-2 top-2 z-10 w-[210px] rounded-2xl border border-border bg-surface/95 p-2 shadow-xl backdrop-blur md:block ${
              paleta ? 'block' : 'hidden'
            }`}
            aria-label="Adicionar bloco"
          >
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/80">Adicionar bloco</div>
            {TIPOS_NOVOS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => criarBloco(t)}
                title={DESCRICAO_TIPO[t]}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-white/5"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md text-[13px]" style={{ background: `${COR[t]}22` }} aria-hidden="true">
                  {ICONE[t]}
                </span>
                <span className="truncate">{ROTULO_TIPO[t].replace(' (fora das 24 h)', '')}</span>
              </button>
            ))}
            <p className="mt-1.5 px-2 pb-1 text-[10.5px] leading-relaxed text-muted">
              Dica: arraste a bolinha de uma saída para o vazio e escolha o próximo bloco.
            </p>
          </nav>
          <button
            type="button"
            onClick={() => setPaleta((v) => !v)}
            className={`${btnPrimario} absolute bottom-4 left-1/2 z-10 -translate-x-1/2 shadow-xl md:hidden`}
          >
            {paleta ? 'Fechar' : '+ Bloco'}
          </button>

          {/* ── Canvas ── */}
          <div ref={wrapperRef} className="fluxo-canvas relative min-h-0 flex-1">
            <ReactFlow<NoRF, Edge>
              nodes={nodes}
              edges={setasVisiveis}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onNodeClick={(_, n) => setSel(n.id)}
              onPaneClick={() => {
                setSel(null);
                setMenu(null);
              }}
              isValidConnection={(c) => c.source !== c.target}
              deleteKeyCode={['Backspace', 'Delete']}
              snapToGrid
              snapGrid={[20, 20]}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.75}
              colorMode="dark"
              defaultEdgeOptions={{ type: 'default' }}
              proOptions={{ hideAttribution: false }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#1D4F54" />
              <Controls showInteractive={false} position="bottom-right" />
              <MiniMap
                position="top-right"
                pannable
                zoomable
                className="!hidden md:!block"
                nodeColor={(n) => COR[(n as NoRF).data.no.tipo]}
                maskColor="rgba(5,28,30,.7)"
                style={{ background: '#09282B', border: '1px solid #1D4F54', borderRadius: 12 }}
              />
            </ReactFlow>

            {menu && (
              <div
                className="absolute z-30 w-[240px] rounded-2xl border border-border bg-surface p-1.5 shadow-2xl"
                style={{ left: menu.x, top: menu.y }}
                role="menu"
              >
                <div className="flex items-center justify-between px-2 pb-1 pt-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/80">Próximo bloco</span>
                  <button type="button" onClick={() => setMenu(null)} className="text-xs text-muted hover:text-ink" aria-label="Fechar">
                    ✕
                  </button>
                </div>
                {TIPOS_NOVOS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="menuitem"
                    onClick={() => criarBloco(t, rf.screenToFlowPosition({ x: menu.cx + 30, y: menu.cy - 30 }), menu.de, menu.saida)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                  >
                    <span aria-hidden="true">{ICONE[t]}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink">{ROTULO_TIPO[t]}</span>
                      <span className="block truncate text-[10.5px] text-muted">{DESCRICAO_TIPO[t]}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {nodes.length <= 2 && !sel && (
              <div className="pointer-events-none absolute bottom-16 left-1/2 hidden -translate-x-1/2 rounded-full border border-border bg-surface/90 px-4 py-2 text-xs text-muted md:block">
                Clique num bloco para editar · arraste das bolinhas para ligar · Delete apaga o selecionado
              </div>
            )}
          </div>

          {/* ── Painel do bloco ── */}
          {noSel && (
            <Painel
              key={noSel.id}
              no={noSel}
              mudar={atualizarNo}
              fechar={() => selecionar(null)}
              rec={rec}
              problemas={problemas.filter((p) => p.noId === noSel.id)}
              fluxoId={fluxo.id}
              conexaoDoFluxo={fluxo.connection_id}
            />
          )}

          {/* ── Gavetas ── */}
          {gaveta && gaveta !== 'teste' && (
            <Gaveta titulo={{ validacao: 'Conferência do fluxo', gatilhos: 'Gatilhos deste fluxo', pessoas: 'Pessoas no fluxo' }[gaveta]} fechar={() => setGaveta(null)}>
              {gaveta === 'validacao' && (
                <ListaProblemas
                  itens={problemas}
                  focar={(nid) => {
                    focar(nid);
                    setGaveta(null);
                  }}
                />
              )}
              {gaveta === 'gatilhos' && <ListaGatilhos gatilhos={gatilhos} />}
              {gaveta === 'pessoas' && (
                <ListaPessoas
                  execucoes={execucoes}
                  nomeDoNo={(nid) => {
                    const n = nodes.find((x) => x.id === nid)?.data.no;
                    return n ? n.titulo || ROTULO_TIPO[n.tipo] : null;
                  }}
                  focar={focar}
                  recarregar={carregarStats}
                />
              )}
            </Gaveta>
          )}
        </div>
      </div>

      {problemasServidor && (
        <Modal titulo="Corrija antes de ativar" fechar={() => setProblemasServidor(null)}>
          <p className="mb-3 text-sm text-muted">A Meta recusaria estas mensagens com o cliente esperando. Clique num item para ir ao bloco.</p>
          <ListaProblemas
            itens={problemasServidor.map((p) => ({ ...p, grave: true }))}
            focar={(nid) => {
              focar(nid);
              setProblemasServidor(null);
            }}
          />
        </Modal>
      )}

      {gaveta === 'teste' && (
        <DialogoTeste
          fluxoId={fluxo.id}
          comecaComTemplate={(() => {
            const ini = grafo.nos.find((n) => n.tipo === 'inicio');
            const l = ini && grafo.ligacoes.find((x) => x.de === ini.id);
            return grafo.nos.find((n) => n.id === l?.para)?.tipo === 'template';
          })()}
          antes={salvar}
          depois={carregarStats}
          fechar={() => setGaveta(null)}
        />
      )}

      <style>{`
        .fluxo-canvas .react-flow { --xy-background-color: #051C1E; --xy-edge-stroke-default: #D7F264; --xy-connectionline-stroke-default: #E3F58F; --xy-connectionline-stroke-width-default: 2; }
        .fluxo-canvas .react-flow__node-bloco { border: 0; background: transparent; padding: 0; }
        .fluxo-canvas .react-flow__controls { box-shadow: none; border: 1px solid #1D4F54; border-radius: 12px; overflow: hidden; }
        .fluxo-canvas .react-flow__controls-button { background: #09282B; border-bottom: 1px solid #1D4F54; fill: #F8F6F7; }
        .fluxo-canvas .react-flow__controls-button:hover { background: #0F3A3F; }
        .fluxo-canvas .react-flow__attribution { background: transparent; opacity: .35; }
        .fluxo-canvas .react-flow__attribution a { color: #8FAEA9; }
        .fluxo-canvas .react-flow__handle { cursor: crosshair; }
        .fluxo-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: #F8F6F7; }
      `}</style>
    </Ctx.Provider>
  );
}

// ── Peças ────────────────────────────────────────────────────────────────────────

function Gaveta({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: React.ReactNode }) {
  return (
    <aside className="absolute inset-x-0 bottom-0 z-30 flex max-h-[70%] flex-col rounded-t-2xl border-t border-border bg-surface shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[400px] md:rounded-none md:border-l md:border-t-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-ink">{titulo}</h2>
        <button type="button" onClick={fechar} className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-ink" aria-label="Fechar">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

function Modal({ titulo, fechar, children }: { titulo: string; fechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 p-0 md:items-center md:p-6" role="dialog" aria-modal="true" aria-label={titulo}>
      <button type="button" className="absolute inset-0 cursor-default" onClick={fechar} aria-label="Fechar" />
      <div className="relative max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-2xl md:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-display text-xl text-ink">{titulo}</h2>
          <button type="button" onClick={fechar} className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-ink" aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ListaProblemas({
  itens,
  focar,
}: {
  itens: { noId: string | null; mensagem: string; grave: boolean }[];
  focar: (id: string) => void;
}) {
  if (!itens.length) {
    return <p className="text-sm text-green">✓ Nenhum problema encontrado. O fluxo pode ser ativado.</p>;
  }
  const ordenados = [...itens].sort((a, b) => Number(b.grave) - Number(a.grave));
  return (
    <ul className="flex flex-col gap-1.5">
      {ordenados.map((p, i) => (
        <li key={i}>
          <button
            type="button"
            disabled={!p.noId}
            onClick={() => p.noId && focar(p.noId)}
            className={`w-full rounded-xl border px-3 py-2 text-left text-[13px] leading-snug transition-colors enabled:hover:border-blue2 ${
              p.grave ? 'border-orange/30 bg-orange/[0.06] text-[#ffb183]' : 'border-border text-[#fab219]'
            }`}
          >
            <span className="mr-1.5 text-[10px] font-semibold uppercase">{p.grave ? 'Erro' : 'Aviso'}</span>
            {p.mensagem}
          </button>
        </li>
      ))}
      <li className="mt-2 text-[11px] text-muted">Erros impedem ativar. Avisos não impedem, mas vale olhar.</li>
    </ul>
  );
}

function resumoGatilho(g: Gatilho): string {
  const c = g.config ?? {};
  switch (g.tipo) {
    case 'palavra_chave':
      return `${(c.palavras ?? []).join(', ')} · ${c.modo === 'exata' ? 'exata' : c.modo === 'comeca' ? 'começa com' : 'contém'}`;
    case 'link_ref':
      return `código "${c.codigo ?? ''}"`;
    case 'anuncio':
      return c.ad_ids?.length ? `${c.ad_ids.length} anúncio(s)` : 'qualquer anúncio';
    case 'tag_adicionada':
      return `tag "${c.tag ?? ''}"`;
    case 'padrao':
      return `no máximo 1x a cada ${c.intervalo_horas ?? 24} h`;
    case 'webhook':
      return 'chamado pela LP / n8n';
    default:
      return 'primeira mensagem da pessoa';
  }
}

function ListaGatilhos({ gatilhos }: { gatilhos: Gatilho[] }) {
  return (
    <div>
      {gatilhos.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          Este fluxo ainda não tem gatilho — ele só roda se você iniciar à mão (Testar ou pela caixa de conversa). Crie um gatilho para ele
          responder sozinho.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gatilhos.map((g) => (
            <li key={g.id} className="rounded-xl border border-border bg-surface2/60 p-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[13px] font-semibold text-ink">{ROTULO_GATILHO[g.tipo]}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${g.ativo ? 'bg-green/10 text-green' : 'bg-muted/15 text-muted'}`}>
                  {g.ativo ? 'ligado' : 'desligado'}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted">{resumoGatilho(g)}</div>
              <div className="mt-1 text-[11px] text-muted/80">{g.disparos} disparo(s)</div>
            </li>
          ))}
        </ul>
      )}
      <Link href="/automacoes" className="mt-4 inline-block text-[13px] font-semibold text-[#D7F264] underline underline-offset-2">
        Criar e editar gatilhos em Automações →
      </Link>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">O gatilho só dispara com o fluxo ATIVO.</p>
    </div>
  );
}

function ListaPessoas({
  execucoes,
  nomeDoNo,
  focar,
  recarregar,
}: {
  execucoes: Execucao[];
  nomeDoNo: (id: string) => string | null;
  focar: (id: string) => void;
  recarregar: () => Promise<void>;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted">As 50 entradas mais recentes.</p>
        <button type="button" className="text-xs font-semibold text-[#D7F264] underline" onClick={() => void recarregar()}>
          Atualizar
        </button>
      </div>
      {execucoes.length === 0 ? (
        <p className="text-sm text-muted">Ninguém passou por este fluxo ainda.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {execucoes.map((e) => {
            const est = ESTADO_EXEC[e.estado] ?? { rotulo: e.estado, cls: 'bg-muted/15 text-muted' };
            const nomeNo = e.no_atual ? nomeDoNo(e.no_atual) : null;
            return (
              <li key={e.id} className="rounded-xl border border-border p-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {e.wa_conversas?.nome_perfil || (e.wa_conversas ? `+${e.wa_conversas.wa_id}` : 'contato')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${est.cls}`}>{est.rotulo}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                  <span>{new Date(e.iniciada_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  {nomeNo && e.no_atual && (
                    <button type="button" onClick={() => focar(e.no_atual!)} className="truncate text-[#D7F264] underline underline-offset-2">
                      em “{nomeNo}”
                    </button>
                  )}
                  {e.estado === 'aguardando_tempo' && e.acordar_em && (
                    <span>· segue {new Date(e.acordar_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  )}
                </div>
                {e.erro && <div className="mt-1 text-[11px] text-[#ffb183]">{e.erro}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DialogoTeste({
  fluxoId,
  comecaComTemplate,
  antes,
  depois,
  fechar,
}: {
  fluxoId: string;
  comecaComTemplate: boolean;
  antes: () => Promise<boolean>;
  depois: () => Promise<void>;
  fechar: () => void;
}) {
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function testar() {
    setEnviando(true);
    setResultado(null);
    const salvou = await antes();
    if (!salvou) {
      setResultado({ ok: false, texto: 'Não consegui salvar o fluxo antes do teste. Confira os avisos no topo.' });
      setEnviando(false);
      return;
    }
    try {
      const r = await fetch(`/api/fluxos/${fluxoId}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setResultado({ ok: false, texto: b.error ?? 'O teste não começou.' });
      else if (b.execucao?.estado === 'erro') setResultado({ ok: false, texto: `Começou, mas parou com erro: ${b.execucao.erro}` });
      else setResultado({ ok: true, texto: 'Enviado! Olhe o WhatsApp desse número. Responda por lá para seguir o fluxo.' });
      await depois();
    } catch {
      setResultado({ ok: false, texto: 'Sem conexão com o servidor.' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Testar no meu WhatsApp" fechar={fechar}>
      <p className="mb-3 text-sm leading-relaxed text-muted">
        O fluxo roda de verdade para o número abaixo — mesmo em rascunho. Assim você vê exatamente o que o cliente vai receber.
      </p>
      <div
        className={`mb-4 rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed ${
          comecaComTemplate ? 'border-green/30 bg-green/[0.06] text-green' : 'border-[#fab219]/30 bg-[#fab219]/[0.07] text-[#fab219]'
        }`}
      >
        {comecaComTemplate ? (
          <>Este fluxo começa com um Template, então funciona para qualquer número.</>
        ) : (
          <>
            <b>Regra das 24 h da Meta:</b> mensagem comum só chega se esse número mandou uma mensagem para o WhatsApp oficial nas últimas 24 h.
            Mande um “oi” do seu celular para o número antes de testar.
          </>
        )}
      </div>
      <label className="mb-1.5 block text-[13px] font-semibold text-ink" htmlFor="tel-teste">
        Seu WhatsApp (com DDD)
      </label>
      <input
        id="tel-teste"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
        placeholder="11 99999-8888"
        inputMode="tel"
        className={inputCls}
        onKeyDown={(e) => e.key === 'Enter' && telefone.replace(/\D/g, '').length >= 10 && void testar()}
      />
      {resultado && (
        <p className={`mt-3 text-sm ${resultado.ok ? 'text-green' : 'text-[#ffb183]'}`} role="status">
          {resultado.texto}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={btn} onClick={fechar}>
          Fechar
        </button>
        <button type="button" className={btnPrimario} disabled={enviando || telefone.replace(/\D/g, '').length < 10} onClick={() => void testar()}>
          {enviando ? 'Enviando…' : 'Iniciar o fluxo'}
        </button>
      </div>
    </Modal>
  );
}
