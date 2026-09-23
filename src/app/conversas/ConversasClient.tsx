'use client';

// A caixa de conversa do número oficial — o "Live Chat" do ManyChat.
//
// Tudo que entra pela API oficial cai aqui, com o que o robô respondeu no meio. O
// atendente vê a conversa inteira, assume quando precisa (pausando o robô) e devolve
// quando termina. Sem websocket: a lista se atualiza a cada 5 s e para quando a aba
// fica escondida, para não gastar banco à toa.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { janelaAberta } from '@/lib/automacao/tipos';
import { ChatAberto } from '@/components/conversas/ChatAberto';
import {
  WA,
  intervaloVisivel,
  nomeDaConversa,
  quandoNaLista,
  type CampoDef,
  type ConversaLista,
  type FluxoResumo,
} from '@/components/conversas/comum';

type Filtro = 'abertas' | 'nao_lidas' | 'pausadas' | 'fechadas' | 'todas';

const FILTROS: [Filtro, string][] = [
  ['abertas', 'Abertas'],
  ['nao_lidas', 'Não lidas'],
  ['pausadas', 'Robô pausado'],
  ['fechadas', 'Fechadas'],
  ['todas', 'Todas'],
];

function Inicial({ nome }: { nome: string }) {
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg"
      style={{ background: '#6a7175', color: '#cfd4d6' }}
      aria-hidden="true"
    >
      {(nome.replace(/[^\p{L}]/gu, '')[0] ?? '#').toUpperCase()}
    </span>
  );
}

export function ConversasClient() {
  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [conversas, setConversas] = useState<ConversaLista[] | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [campos, setCampos] = useState<CampoDef[]>([]);
  const [fluxos, setFluxos] = useState<FluxoResumo[]>([]);
  const [agora, setAgora] = useState(() => Date.now());

  // `/conversas?id=…` abre direto uma conversa (links vindos de outras telas).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return;
    const t = setTimeout(() => setAberta(id), 0);
    return () => clearTimeout(t);
  }, []);

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(async () => {
    const qs = new URLSearchParams({ filtro });
    if (buscaAplicada) qs.set('busca', buscaAplicada);
    try {
      const res = await fetch(`/api/conversas?${qs}`, { cache: 'no-store' });
      const b = (await res.json().catch(() => ({}))) as { conversas?: ConversaLista[]; nao_lidas?: number; error?: string };
      if (!res.ok) {
        setErro(b.error ?? 'Não consegui carregar as conversas.');
        setConversas((c) => c ?? []);
        return;
      }
      setErro(null);
      setConversas(b.conversas ?? []);
      setNaoLidas(b.nao_lidas ?? 0);
      setAgora(Date.now());
    } catch {
      setErro('Sem conexão com o servidor.');
      setConversas((c) => c ?? []);
    }
  }, [filtro, buscaAplicada]);

  useEffect(() => {
    const primeira = setTimeout(() => void carregar(), 0);
    const parar = intervaloVisivel(() => void carregar(), 5000);
    return () => {
      clearTimeout(primeira);
      parar();
    };
  }, [carregar]);

  // Campos personalizados e fluxos mudam pouco: uma leitura por visita basta.
  useEffect(() => {
    fetch('/api/campos')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.campos && setCampos(b.campos as CampoDef[]))
      .catch(() => {});
    fetch('/api/fluxos')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.fluxos && setFluxos(b.fluxos as FluxoResumo[]))
      .catch(() => {});
  }, []);

  const recarregarLista = useCallback(() => void carregar(), [carregar]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">
            Conversas
            {naoLidas > 0 && (
              <span className="ml-2 inline-block rounded-full bg-blue px-2 py-0.5 align-middle font-sans text-xs font-semibold text-on-blue">
                {naoLidas} não lida{naoLidas > 1 ? 's' : ''}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Tudo que chega pelo número oficial, com o que o robô respondeu. Assuma a conversa quando precisar — o robô
            pausa sozinho quando você responde.
          </p>
        </div>
      </div>

      <div
        className="flex h-[calc(100dvh-12rem)] min-h-[480px] overflow-hidden rounded-xl2 border border-border md:h-[calc(100dvh-11rem)]"
        style={{ background: WA.lista, color: WA.texto }}
      >
        {/* LISTA — no celular some quando uma conversa está aberta */}
        <aside
          className={`${aberta ? 'hidden md:flex' : 'flex'} w-full min-w-0 flex-col border-r md:w-[320px] md:shrink-0 xl:w-[360px]`}
          style={{ borderColor: WA.linha }}
        >
          <div className="space-y-2 px-3 py-2.5" style={{ background: WA.lista }}>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou número"
              aria-label="Buscar conversa"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none placeholder:text-[#8696a0]"
              style={{ background: WA.barra, color: WA.texto }}
            />
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {FILTROS.map(([k, rotulo]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setFiltro(k);
                    setConversas(null);
                  }}
                  aria-pressed={filtro === k}
                  className="shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] transition-colors"
                  style={filtro === k ? { background: '#0a332c', color: '#d9fdd3' } : { background: WA.barra, color: WA.cinza }}
                >
                  {rotulo}
                  {k === 'nao_lidas' && naoLidas > 0 ? <span className="opacity-70"> {naoLidas}</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {erro && (
              <div className="mx-3 mb-2 rounded-lg px-3 py-2.5 text-[13px]" role="alert" style={{ background: WA.erroFundo, color: WA.erroTexto }}>
                {erro}
              </div>
            )}
            {conversas === null ? (
              <p className="px-4 py-6 text-sm" style={{ color: WA.cinza }}>
                Carregando conversas…
              </p>
            ) : conversas.length === 0 ? (
              <div className="px-4 py-6 text-sm leading-relaxed" style={{ color: WA.cinza }}>
                {buscaAplicada ? (
                  'Nada encontrado com essa busca.'
                ) : filtro === 'abertas' || filtro === 'todas' ? (
                  <>
                    Nenhuma conversa ainda. Assim que alguém escrever para o número oficial, ela aparece aqui.
                    <br />
                    <Link href="/conexoes" className="underline">
                      Conferir a conexão com a Meta
                    </Link>
                  </>
                ) : (
                  'Nada por aqui.'
                )}
              </div>
            ) : (
              conversas.map((c) => {
                const nome = nomeDaConversa(c, c.contacts?.nome);
                const pausada = c.automacao_pausada_ate && new Date(c.automacao_pausada_ate).getTime() > agora;
                const janela = janelaAberta(c.ultima_entrada_em, agora);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAberta(c.id)}
                    className="flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-[#202c33]"
                    style={aberta === c.id ? { background: WA.selecionada } : undefined}
                  >
                    <Inicial nome={nome} />
                    <span className="min-w-0 flex-1 border-b py-3" style={{ borderColor: WA.linha }}>
                      <span className="flex items-baseline gap-2">
                        <span className={`min-w-0 flex-1 truncate text-[15px] ${c.nao_lidas ? 'font-semibold' : ''}`}>{nome}</span>
                        <span className="shrink-0 text-[11.5px]" style={{ color: c.nao_lidas ? WA.verde : WA.cinza }}>
                          {quandoNaLista(c.ultima_mensagem_em)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[13px]" style={{ color: WA.cinza }}>
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: janela ? WA.verde : '#5b6870' }}
                          title={janela ? 'Janela de 24 h aberta: dá para responder com texto livre' : 'Janela fechada: só template'}
                          aria-label={janela ? 'janela aberta' : 'janela fechada'}
                        />
                        <span className="min-w-0 flex-1 truncate">{c.ultima_previa ?? ''}</span>
                        {pausada && (
                          <span className="shrink-0 rounded px-1 text-[10.5px]" style={{ background: '#3b2a12', color: '#fab219' }} title="Robô pausado nesta conversa">
                            ⏸ robô
                          </span>
                        )}
                        {c.status === 'fechada' && (
                          <span className="shrink-0 rounded px-1 text-[10.5px]" style={{ background: '#2a3942' }}>
                            fechada
                          </span>
                        )}
                        {c.nao_lidas > 0 && (
                          <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold" style={{ background: WA.verde, color: WA.fundo }}>
                            {c.nao_lidas}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* CONVERSA + PAINEL DO CONTATO */}
        <div className={`${aberta ? 'flex' : 'hidden md:flex'} min-w-0 flex-1`}>
          {aberta ? (
            <ChatAberto
              key={aberta}
              conversaId={aberta}
              campos={campos}
              fluxos={fluxos}
              onVoltar={() => setAberta(null)}
              onMudouLista={recarregarLista}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center" style={{ background: '#222e35', color: WA.cinza }}>
              <span className="text-4xl" aria-hidden="true">
                💬
              </span>
              <p className="max-w-[360px] text-sm leading-relaxed">
                Escolha uma conversa. O ponto verde indica que a janela de 24 h está aberta — dá para responder com texto
                livre; fora dela, só com template aprovado.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
