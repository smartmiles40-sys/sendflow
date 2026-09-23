'use client';

// A conversa aberta: cabeçalho com os controles do robô, os balões e a caixa de
// digitar — mais o painel do contato à direita.
//
// Atualiza sozinha a cada 4 s (sem websocket: a Vercel não segura conexão aberta, e
// 4 s é rápido o bastante para uma conversa humana).

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { janelaAberta } from '@/lib/automacao/tipos';
import { formatarTelefone } from '@/lib/whatsapp/jid';
import { Bolha } from './Bolha';
import { Compositor } from './Compositor';
import { PainelContato } from './PainelContato';
import {
  WA,
  EXECUCAO_ATIVA,
  acaoNaConversa,
  falta,
  intervaloVisivel,
  nomeDaConversa,
  rotuloDoDia,
  type CampoDef,
  type DetalheConversa,
  type FluxoResumo,
} from './comum';

const PAPEL_DE_PAREDE =
  "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"40\"><circle cx=\"4\" cy=\"4\" r=\"1\" fill=\"%23131f27\"/></svg>')";

type Menu = null | 'pausar' | 'fluxo' | 'parar';

export function ChatAberto({
  conversaId,
  campos,
  fluxos,
  onVoltar,
  onMudouLista,
}: {
  conversaId: string;
  campos: CampoDef[];
  fluxos: FluxoResumo[];
  onVoltar: () => void;
  onMudouLista: () => void;
}) {
  const [detalhe, setDetalhe] = useState<DetalheConversa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Tela larga já abre com o painel do contato (as três colunas); tela menor, só a conversa.
  const [painel, setPainel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  const [menu, setMenu] = useState<Menu>(null);
  const [fluxoEscolhido, setFluxoEscolhido] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const fundoRef = useRef<HTMLDivElement>(null);
  const colarNoFim = useRef(true);
  const ultimaQtd = useRef(0);
  const marcouLida = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversas/${conversaId}`, { cache: 'no-store' });
      const b = (await res.json().catch(() => ({}))) as DetalheConversa & { error?: string };
      if (!res.ok) {
        setErro(b.error ?? 'Não consegui abrir a conversa.');
        return;
      }
      setErro(null);
      setDetalhe(b);
      setAgora(Date.now());
      // Chegou mensagem nova com a conversa na tela: já conta como lida.
      if (b.conversa.nao_lidas > 0 || !marcouLida.current) {
        marcouLida.current = true;
        if (b.conversa.nao_lidas > 0) {
          void acaoNaConversa(conversaId, { acao: 'lida' }).then(() => onMudouLista());
        }
      }
    } catch {
      setErro('Sem conexão com o servidor.');
    }
  }, [conversaId, onMudouLista]);

  useEffect(() => {
    const primeira = setTimeout(() => void carregar(), 0);
    const parar = intervaloVisivel(() => void carregar(), 4000);
    return () => {
      clearTimeout(primeira);
      parar();
    };
  }, [carregar]);

  // Rola para o fim quando chega mensagem — a menos que a pessoa tenha subido para ler.
  const qtd = detalhe?.mensagens.length ?? 0;
  useEffect(() => {
    const el = fundoRef.current;
    if (!el || qtd === ultimaQtd.current) return;
    const primeira = ultimaQtd.current === 0;
    ultimaQtd.current = qtd;
    if (primeira || colarNoFim.current) el.scrollTop = el.scrollHeight;
  }, [qtd]);

  async function acao(corpo: Record<string, unknown>, ok?: string) {
    setOcupado(true);
    const e = await acaoNaConversa(conversaId, corpo);
    setOcupado(false);
    setMenu(null);
    if (e) {
      setAviso(e);
      return;
    }
    setAviso(ok ?? null);
    await carregar();
    onMudouLista();
  }

  if (!detalhe) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm" style={{ background: WA.fundo, color: erro ? WA.erroTexto : WA.cinza }}>
        {erro ?? 'Abrindo conversa…'}
      </div>
    );
  }

  const { conversa, contato, conexao, execucoes, mensagens } = detalhe;
  const nome = nomeDaConversa(conversa, contato?.nome);
  const aberta = janelaAberta(conversa.ultima_entrada_em, agora);
  const fechaEm = conversa.ultima_entrada_em ? new Date(new Date(conversa.ultima_entrada_em).getTime() + 86_400_000).toISOString() : null;
  const pausadaAte =
    conversa.automacao_pausada_ate && new Date(conversa.automacao_pausada_ate).getTime() > agora ? conversa.automacao_pausada_ate : null;
  const fluxosAtivos = execucoes.filter((x) => EXECUCAO_ATIVA.has(x.estado)).length;
  const botao = 'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] transition-colors hover:bg-white/10 disabled:opacity-50';

  return (
    <div className="flex min-w-0 flex-1">
      <section className={`${painel ? 'hidden lg:flex' : 'flex'} min-w-0 flex-1 flex-col`}>
        <header className="flex items-center gap-2 px-2 py-2 sm:px-3" style={{ background: WA.barra }}>
          <button type="button" onClick={onVoltar} className="rounded-full px-2 py-1.5 text-lg hover:bg-white/10 md:hidden" aria-label="Voltar para a lista">
            ←
          </button>
          <button type="button" onClick={() => setPainel((p) => !p)} className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left hover:bg-white/5" title="Dados do contato">
            <span className="block truncate text-[15px] font-semibold">{nome}</span>
            <span className="block truncate text-[12px]" style={{ color: WA.cinza }}>
              {formatarTelefone(conversa.wa_id)}
              {' · '}
              {aberta && fechaEm ? (
                <span style={{ color: '#9fe8c9' }}>janela fecha em {falta(fechaEm, agora)}</span>
              ) : (
                <span style={{ color: '#f7b5bd' }}>janela de 24 h fechada</span>
              )}
              {conexao ? ` · ${conexao.nome}` : ''}
            </span>
          </button>
          <button type="button" onClick={() => setPainel((p) => !p)} className={`${botao} hidden sm:block`} aria-expanded={painel}>
            👤 Contato
          </button>
        </header>

        {/* Controles do robô e da conversa */}
        <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5 sm:px-3" style={{ background: WA.lista, borderColor: WA.linha, color: WA.texto }}>
          {pausadaAte ? (
            <button type="button" disabled={ocupado} onClick={() => void acao({ acao: 'retomar' }, 'Robô de volta: as automações respondem esta pessoa de novo.')} className={botao} style={{ background: '#3b2a12', color: '#fab219' }}>
              ⏸ Robô pausado · {falta(pausadaAte, agora)} · Retomar
            </button>
          ) : (
            <button type="button" disabled={ocupado} onClick={() => setMenu(menu === 'pausar' ? null : 'pausar')} className={botao} aria-expanded={menu === 'pausar'}>
              ⏸ Pausar robô
            </button>
          )}
          <button type="button" disabled={ocupado} onClick={() => setMenu(menu === 'fluxo' ? null : 'fluxo')} className={botao} aria-expanded={menu === 'fluxo'}>
            ▶ Iniciar fluxo
          </button>
          {fluxosAtivos > 0 && (
            <button type="button" disabled={ocupado} onClick={() => setMenu(menu === 'parar' ? null : 'parar')} className={botao} aria-expanded={menu === 'parar'}>
              ⏹ Parar fluxos ({fluxosAtivos})
            </button>
          )}
          <button
            type="button"
            disabled={ocupado}
            onClick={() =>
              void acao(
                { acao: conversa.status === 'fechada' ? 'abrir' : 'fechar' },
                conversa.status === 'fechada' ? 'Conversa reaberta.' : 'Conversa fechada — ela volta para "Abertas" quando a pessoa escrever.',
              )
            }
            className={botao}
          >
            {conversa.status === 'fechada' ? '↺ Reabrir' : '✓ Fechar conversa'}
          </button>
        </div>

        {menu === 'pausar' && (
          <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-[12.5px]" style={{ background: WA.barra, borderColor: WA.linha, color: WA.texto }}>
            <span style={{ color: WA.cinza }}>Nenhuma automação responde esta pessoa por:</span>
            {[
              [1, '1 h'],
              [12, '12 h'],
              [24, '24 h'],
              [168, '7 dias'],
            ].map(([h, r]) => (
              <button key={h} type="button" disabled={ocupado} onClick={() => void acao({ acao: 'pausar', horas: h }, `Robô pausado por ${r}.`)} className="rounded-full px-3 py-1 font-semibold" style={{ background: '#0a332c', color: '#d9fdd3' }}>
                {r}
              </button>
            ))}
            <button type="button" onClick={() => setMenu(null)} className="ml-auto underline" style={{ color: WA.cinza }}>
              Cancelar
            </button>
          </div>
        )}

        {menu === 'fluxo' && (
          <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-[12.5px]" style={{ background: WA.barra, borderColor: WA.linha, color: WA.texto }}>
            {fluxos.length === 0 ? (
              <span style={{ color: WA.cinza }}>Nenhum fluxo criado ainda. Crie em Automações.</span>
            ) : (
              <>
                <select
                  value={fluxoEscolhido}
                  onChange={(e) => setFluxoEscolhido(e.target.value)}
                  aria-label="Fluxo para iniciar"
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 outline-none"
                  style={{ background: '#2a3942', color: WA.texto }}
                >
                  <option value="">Escolha o fluxo…</option>
                  {fluxos.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                      {f.status !== 'ativo' ? ` (${f.status})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={ocupado || !fluxoEscolhido}
                  onClick={() => void acao({ acao: 'iniciar_fluxo', fluxoId: fluxoEscolhido }, 'Fluxo iniciado — o robô assumiu a conversa.')}
                  className="rounded-full px-3 py-1 font-semibold disabled:opacity-50"
                  style={{ background: WA.verde, color: WA.fundo }}
                >
                  Iniciar
                </button>
              </>
            )}
            <span className="w-full" style={{ color: WA.cinza }}>
              {aberta
                ? 'Iniciar tira a pausa do robô.'
                : 'Janela fechada: o fluxo só consegue falar se começar por um bloco Template.'}
            </span>
          </div>
        )}

        {menu === 'parar' && (
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-[12.5px]" style={{ background: WA.barra, borderColor: WA.linha, color: WA.texto }}>
            <span>Parar {fluxosAtivos === 1 ? 'o fluxo que está' : `os ${fluxosAtivos} fluxos que estão`} rodando para esta pessoa? Esperas e perguntas pendentes são canceladas.</span>
            <button type="button" disabled={ocupado} onClick={() => void acao({ acao: 'parar_fluxos' }, 'Fluxos parados.')} className="rounded-full px-3 py-1 font-semibold" style={{ background: '#f15c6d', color: '#1a0b0e' }}>
              Sim, parar
            </button>
            <button type="button" onClick={() => setMenu(null)} className="underline" style={{ color: WA.cinza }}>
              Cancelar
            </button>
          </div>
        )}

        {aviso && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]" role="status" style={{ background: '#182229', color: '#d9fdd3' }}>
            <span className="min-w-0 flex-1">{aviso}</span>
            <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" style={{ color: WA.cinza }}>
              ×
            </button>
          </div>
        )}

        <div
          ref={fundoRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            colarNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="flex-1 overflow-y-auto px-3 py-3 sm:px-[5%]"
          style={{ backgroundColor: WA.fundo, backgroundImage: PAPEL_DE_PAREDE, color: WA.texto }}
        >
          {erro && (
            <div className="mx-auto mb-3 max-w-[520px] rounded-lg px-3 py-2 text-center text-[13px]" style={{ background: WA.erroFundo, color: WA.erroTexto }}>
              {erro}
            </div>
          )}
          {mensagens.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: WA.cinza }}>
              Nenhuma mensagem nesta conversa ainda.
            </p>
          ) : (
            mensagens.map((m, i) => {
              const novoDia = i === 0 || rotuloDoDia(m.criado_em) !== rotuloDoDia(mensagens[i - 1].criado_em);
              return (
                <Fragment key={m.id}>
                  {novoDia && (
                    <div className="my-3 text-center">
                      <span className="rounded-lg px-3 py-1 text-[12px] shadow-sm" style={{ background: '#182229', color: WA.cinza }}>
                        {rotuloDoDia(m.criado_em)}
                      </span>
                    </div>
                  )}
                  <Bolha m={m} />
                </Fragment>
              );
            })
          )}
        </div>

        <Compositor
          key={conversa.id}
          conversaId={conversa.id}
          conexaoId={conexao?.id ?? null}
          janelaAberta={aberta}
          onEnviado={() => {
            colarNoFim.current = true;
            void carregar();
            onMudouLista();
          }}
        />
      </section>

      {painel && (
        <aside className="flex w-full min-w-0 flex-col border-l lg:w-[320px] lg:shrink-0" style={{ borderColor: WA.linha }}>
          <PainelContato detalhe={detalhe} campos={campos} onMudou={() => void carregar()} onFechar={() => setPainel(false)} />
        </aside>
      )}
    </div>
  );
}
