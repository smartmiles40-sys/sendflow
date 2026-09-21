'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection, GroupTag } from '@/lib/types';
import { podeEditar, type Balao, type Conversa, type Tique } from '@/lib/whatsapp/conversas';
import { formatWhen } from '@/lib/format';
import { uploadMedia } from '@/lib/upload-client';
import { TagChip } from '@/components/TagChip';
import { PainelDoGrupo } from './PainelDoGrupo';
import { REACOES_RAPIDAS, WA } from './wa';

const PAPEL_DE_PAREDE =
  "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"40\"><circle cx=\"4\" cy=\"4\" r=\"1\" fill=\"%23131f27\"/></svg>')";

type ConversaTela = Conversa & {
  sendflow: boolean;
  ativo: boolean;
  naFila: boolean;
  /** Id do grupo no SendFlow (nulo quando não cadastrado). */
  grupoId: string | null;
  tag_ids: string[];
};
type Filtro = 'sendflow' | 'grupos' | 'contatos' | 'todas';

interface Origem {
  campanha_id: string;
  campanha: string;
  midia_url: string | null;
}

interface NaFila {
  id: string;
  nome: string;
  tipo: string;
  mensagem: string;
  midia_url: string | null;
  mencionar_todos: boolean;
  enquete_opcoes?: string[] | null;
  enviar_em: string | null;
  status: string;
  cadencia_id: string | null;
}

const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const DIA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });

function horaDe(ts: number): string {
  return ts ? HORA.format(new Date(ts * 1000)) : '';
}

function rotuloDoDia(ts: number): string {
  const d = DIA.format(new Date(ts * 1000));
  if (d === DIA.format(new Date())) return 'Hoje';
  if (d === DIA.format(new Date(Date.now() - 86_400_000))) return 'Ontem';
  return d;
}

/** Na lista: hora se for hoje, "Ontem", ou a data. */
function quandoNaLista(ts: number): string {
  if (!ts) return '';
  const r = rotuloDoDia(ts);
  return r === 'Hoje' ? horaDe(ts) : r === 'Ontem' ? r : r.slice(0, 5);
}

/** *negrito*, _itálico_ e ~riscado~ do WhatsApp, sem innerHTML. */
function formatar(texto: string): React.ReactNode[] {
  const partes = texto.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return partes.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <b key={i}>{p.slice(1, -1)}</b>;
    if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>;
    if (/^~[^~]+~$/.test(p)) return <s key={i}>{p.slice(1, -1)}</s>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Tiques({ tique, grupo }: { tique: Tique; grupo: boolean }) {
  if (tique === 'pendente') return <span title="Saindo do aparelho">🕓</span>;
  if (tique === 'erro') return <span title="O WhatsApp recusou" className="text-[#f15c6d]">⚠</span>;
  if (tique === 'lido') return <span title="Lida" style={{ color: WA.azul }}>✓✓</span>;
  if (tique === 'entregue') return <span title="Entregue">✓✓</span>;
  return (
    <span
      title={
        grupo
          ? 'Enviada: está no grupo. Em grupo o WhatsApp não devolve "entregue/lida" por pessoa para o SendFlow.'
          : 'Enviada ao WhatsApp'
      }
    >
      ✓
    </span>
  );
}

function Avatar({ c, tamanho = 44 }: { c: Pick<Conversa, 'foto' | 'nome' | 'grupo'>; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  if (c.foto && !falhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={c.foto}
        alt=""
        width={tamanho}
        height={tamanho}
        onError={() => setFalhou(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: tamanho, height: tamanho }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-lg"
      style={{ width: tamanho, height: tamanho, background: '#6a7175', color: '#cfd4d6' }}
      aria-hidden="true"
    >
      {c.grupo ? '👥' : (c.nome.replace(/[^\p{L}]/gu, '')[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function CelularClient() {
  const [conexoes, setConexoes] = useState<Connection[]>([]);
  const [conexaoId, setConexaoId] = useState<string>('');
  const [conexaoInfo, setConexaoInfo] = useState<{ nome: string; numero: string | null } | null>(null);
  const [conversas, setConversas] = useState<ConversaTela[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('sendflow');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<ConversaTela | null>(null);
  const [tags, setTags] = useState<GroupTag[]>([]);
  const [tagFiltro, setTagFiltro] = useState<string | null>(null);
  // `/celular?jid=…` (vindo da tela Grupos) abre aquela conversa assim que a lista chega.
  const jidPedido = useRef<string | null>(null);
  useEffect(() => {
    jidPedido.current = new URLSearchParams(window.location.search).get('jid');
  }, []);

  useEffect(() => {
    fetch('/api/connections')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setConexoes(b?.conexoes ?? []))
      .catch(() => {});
  }, []);

  const carregarLista = useCallback(async () => {
    try {
      const r = await fetch(`/api/celular/conversas${conexaoId ? `?conexao=${conexaoId}` : ''}`, { cache: 'no-store' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErroLista(b.error ?? 'Não foi possível ler as conversas.');
        setConversas((c) => c ?? []);
        return;
      }
      setErroLista(null);
      setConexaoInfo(b.conexao);
      setConversas(b.conversas);
      setTags(b.tags ?? []);
      if (jidPedido.current) {
        const alvo = (b.conversas as ConversaTela[]).find((c) => c.jid === jidPedido.current);
        jidPedido.current = null;
        if (alvo) {
          setFiltro('todas');
          setAberta(alvo);
        }
      }
    } catch {
      setErroLista('Sem conexão com o servidor.');
      setConversas((c) => c ?? []);
    }
  }, [conexaoId]);

  useEffect(() => {
    // Primeira leitura num timeout: chamar a busca direto no corpo do efeito dispara
    // setState em cascata (regra react-hooks/set-state-in-effect).
    const primeira = setTimeout(() => void carregarLista(), 0);
    const t = setInterval(() => void carregarLista(), 30_000);
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [carregarLista]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (conversas ?? []).filter((c) => {
      if (filtro === 'sendflow' && !c.sendflow) return false;
      if (filtro === 'grupos' && !c.grupo) return false;
      if (filtro === 'contatos' && c.grupo) return false;
      if (tagFiltro && !c.tag_ids.includes(tagFiltro)) return false;
      if (q && !c.nome.toLowerCase().includes(q) && !(c.telefone ?? '').includes(q)) return false;
      return true;
    });
  }, [conversas, filtro, busca, tagFiltro]);

  const contagemTag = useMemo(() => {
    const conta: Record<string, number> = {};
    for (const c of conversas ?? []) for (const t of c.tag_ids) conta[t] = (conta[t] ?? 0) + 1;
    return conta;
  }, [conversas]);

  /** Tag trocada no painel do grupo: reflete na lista e na conversa aberta sem recarregar. */
  function mudarTagsDe(jid: string, ids: string[]) {
    setConversas((cs) => (cs ?? []).map((c) => (c.jid === jid ? { ...c, tag_ids: ids } : c)));
    setAberta((a) => (a && a.jid === jid ? { ...a, tag_ids: ids } : a));
  }

  function mudarNomeDe(jid: string, nome: string) {
    setConversas((cs) => (cs ?? []).map((c) => (c.jid === jid ? { ...c, nome } : c)));
    setAberta((a) => (a && a.jid === jid ? { ...a, nome } : a));
  }

  const contagem = useMemo(
    () => ({
      sendflow: (conversas ?? []).filter((c) => c.sendflow).length,
      grupos: (conversas ?? []).filter((c) => c.grupo).length,
      contatos: (conversas ?? []).filter((c) => !c.grupo).length,
      todas: (conversas ?? []).length,
    }),
    [conversas],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Celular</h1>
          <p className="mt-1 text-sm text-muted">
            O WhatsApp do número, ao vivo: o que saiu, o que chegou e o que está na fila para sair.
          </p>
        </div>
        {conexoes.length > 1 && (
          <select
            aria-label="Número"
            value={conexaoId}
            onChange={(e) => {
              setConexaoId(e.target.value);
              setAberta(null);
              setConversas(null);
            }}
            className="w-full rounded-xl border border-border bg-surface2 px-3 py-2.5 text-sm text-ink [color-scheme:dark] sm:w-auto"
          >
            <option value="">Primeiro número conectado</option>
            {conexoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.numero ? ` · ${c.numero}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        className="flex h-[calc(100dvh-11rem)] min-h-[460px] overflow-hidden rounded-xl2 border border-border md:h-[calc(100dvh-10.5rem)]"
        style={{ background: WA.lista, color: WA.texto }}
      >
        {/* LISTA — no celular some quando uma conversa está aberta */}
        <aside
          className={`${aberta ? 'hidden md:flex' : 'flex'} w-full min-w-0 flex-col border-r md:w-[340px] md:shrink-0 lg:w-[380px]`}
          style={{ borderColor: '#222d34' }}
        >
          <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ background: WA.barra }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: erroLista ? '#f15c6d' : WA.verde }} aria-hidden="true" />
            <div className="min-w-0 flex-1 text-[13px]">
              <div className="truncate font-semibold">{conexaoInfo?.nome ?? 'Número'}</div>
              <div className="truncate" style={{ color: WA.cinza }}>
                {erroLista ? 'sem leitura' : conexaoInfo?.numero ? `+${conexaoInfo.numero}` : 'conectando…'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void carregarLista()}
              className="rounded-full px-2.5 py-1.5 text-sm transition-colors hover:bg-white/10"
              title="Atualizar"
              aria-label="Atualizar conversas"
            >
              ⟳
            </button>
          </div>

          <div className="space-y-2 px-3 py-2.5">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar conversa"
              aria-label="Pesquisar conversa"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none placeholder:text-[#8696a0]"
              style={{ background: WA.barra, color: WA.texto }}
            />
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {(
                [
                  ['sendflow', 'Grupos do SendFlow'],
                  ['grupos', 'Todos os grupos'],
                  ['contatos', 'Contatos'],
                  ['todas', 'Tudo'],
                ] as [Filtro, string][]
              ).map(([k, rotulo]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFiltro(k)}
                  aria-pressed={filtro === k}
                  className="shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] transition-colors"
                  style={
                    filtro === k
                      ? { background: '#0a332c', color: '#d9fdd3' }
                      : { background: WA.barra, color: WA.cinza }
                  }
                >
                  {rotulo} <span className="opacity-70">{contagem[k]}</span>
                </button>
              ))}
            </div>
            {tags.some((t) => contagemTag[t.id]) && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Filtrar por tag">
                {tags
                  .filter((t) => contagemTag[t.id])
                  .map((t) => (
                    <TagChip
                      key={t.id}
                      tag={t}
                      pequeno
                      contagem={contagemTag[t.id]}
                      ativo={tagFiltro === t.id}
                      onClick={() => setTagFiltro(tagFiltro === t.id ? null : t.id)}
                    />
                  ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {erroLista && (
              <div className="mx-3 mb-2 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: '#3b1d22', color: '#f7b5bd' }}>
                {erroLista}{' '}
                {/nenhum número/i.test(erroLista) && (
                  <Link href="/conexoes" className="underline">
                    Ir para Conexões
                  </Link>
                )}
              </div>
            )}
            {conversas === null ? (
              <p className="px-4 py-6 text-sm" style={{ color: WA.cinza }}>
                Lendo as conversas do aparelho…
              </p>
            ) : visiveis.length === 0 ? (
              <p className="px-4 py-6 text-sm" style={{ color: WA.cinza }}>
                {filtro === 'sendflow'
                  ? 'Nenhum grupo cadastrado no SendFlow aparece neste número. Sincronize em Conexões.'
                  : 'Nada por aqui.'}
              </p>
            ) : (
              visiveis.map((c) => (
                <button
                  key={c.jid}
                  type="button"
                  onClick={() => setAberta(c)}
                  className="flex w-full items-center gap-3 px-3 text-left transition-colors hover:bg-[#202c33]"
                  style={aberta?.jid === c.jid ? { background: WA.selecionada } : undefined}
                >
                  <Avatar c={c} />
                  <span className="min-w-0 flex-1 border-b py-3" style={{ borderColor: '#222d34' }}>
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px]">{c.nome}</span>
                      {c.tag_ids.length > 0 && (
                        <span className="flex shrink-0 gap-0.5 self-center" aria-hidden="true">
                          {c.tag_ids.slice(0, 4).map((id) => {
                            const t = tags.find((x) => x.id === id);
                            return t ? <span key={id} className="h-2 w-2 rounded-full" style={{ background: t.cor }} title={t.nome} /> : null;
                          })}
                        </span>
                      )}
                      <span className="shrink-0 text-[11.5px]" style={{ color: c.naoLidas ? WA.verde : WA.cinza }}>
                        {quandoNaLista(c.ultima?.ts ?? 0)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[13px]" style={{ color: WA.cinza }}>
                      <span className="min-w-0 flex-1 truncate">
                        {c.ultima ? `${c.ultima.fromMe ? 'Você: ' : ''}${c.ultima.texto}` : ''}
                      </span>
                      {c.naFila && (
                        <span title="Tem mensagem agendada para este grupo" className="shrink-0">
                          🕓
                        </span>
                      )}
                      {c.sendflow && !c.ativo && (
                        <span className="shrink-0 rounded px-1 text-[10.5px]" style={{ background: '#2a3942' }}>
                          inativo
                        </span>
                      )}
                      {c.naoLidas > 0 && (
                        <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold" style={{ background: WA.verde, color: WA.fundo }}>
                          {c.naoLidas}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* CONVERSA */}
        <section className={`${aberta ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
          {aberta ? (
            <ConversaAberta
              key={aberta.jid}
              conversa={aberta}
              conexaoId={conexaoId}
              tags={tags}
              onVoltar={() => setAberta(null)}
              onTagsChange={(ids) => mudarTagsDe(aberta.jid, ids)}
              onMudouNome={(nome) => mudarNomeDe(aberta.jid, nome)}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center" style={{ background: '#222e35', color: WA.cinza }}>
              <span className="text-4xl" aria-hidden="true">📱</span>
              <p className="max-w-[340px] text-sm">
                Escolha uma conversa para ver o que saiu, o que o grupo respondeu e o que está agendado.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ConversaAberta({
  conversa,
  conexaoId,
  tags,
  onVoltar,
  onTagsChange,
  onMudouNome,
}: {
  conversa: ConversaTela;
  conexaoId: string;
  tags: GroupTag[];
  onVoltar: () => void;
  onTagsChange: (ids: string[]) => void;
  onMudouNome: (nome: string) => void;
}) {
  const [baloes, setBaloes] = useState<Balao[] | null>(null);
  const [origem, setOrigem] = useState<Record<string, Origem>>({});
  const [naFila, setNaFila] = useState<NaFila[]>([]);
  const [paginas, setPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ tipo: 'enviada' | 'fila'; id: string; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [agoraSeg, setAgoraSeg] = useState(() => Math.floor(Date.now() / 1000));
  const [menuDe, setMenuDe] = useState<{ id: string; left: number; top?: number; bottom?: number } | null>(null);
  const [respondendo, setRespondendo] = useState<Balao | null>(null);
  const [painel, setPainel] = useState(false);
  const fundoRef = useRef<HTMLDivElement>(null);
  const colarNoFim = useRef(true);
  const jaMarcouLida = useRef(false);

  const q = `conexao=${encodeURIComponent(conexaoId)}&jid=${encodeURIComponent(conversa.jid)}`;

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/celular/mensagens?${q}&pagina=1`, { cache: 'no-store' });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(b.error ?? 'Não foi possível ler a conversa.');
        setBaloes((x) => x ?? []);
        return;
      }
      setErro(null);
      setPaginas(b.paginas ?? 1);
      setNaFila(b.naFila ?? []);
      setOrigem((o) => ({ ...o, ...(b.origem ?? {}) }));
      // Junta com o que já foi carregado de páginas antigas, sem duplicar.
      setBaloes((atual) => {
        const mapa = new Map((atual ?? []).map((x) => [x.id, x]));
        for (const x of b.baloes as Balao[]) mapa.set(x.id, x);
        return [...mapa.values()].sort((a, z) => a.ts - z.ts);
      });
      // Abrir a conversa = ler, como no aparelho. Uma vez só, e só se havia não lidas.
      if (!jaMarcouLida.current && conversa.naoLidas > 0) {
        jaMarcouLida.current = true;
        const recebidas = (b.baloes as Balao[]).filter((x) => !x.fromMe).slice(-30).map((x) => x.id);
        if (recebidas.length) {
          void fetch('/api/celular/lida', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conexao: conexaoId || null, jid: conversa.jid, ids: recebidas }),
          }).catch(() => {});
        }
      }
    } catch {
      setErro('Sem conexão com o servidor.');
      setBaloes((x) => x ?? []);
    } finally {
      setAgoraSeg(Math.floor(Date.now() / 1000));
    }
  }, [q, conexaoId, conversa.jid, conversa.naoLidas]);

  useEffect(() => {
    // Primeira leitura num timeout: chamar a busca direto no corpo do efeito dispara
    // setState em cascata (regra react-hooks/set-state-in-effect).
    const primeira = setTimeout(() => void carregar(), 0);
    const t = setInterval(() => void carregar(), 10_000);
    return () => {
      clearTimeout(primeira);
      clearInterval(t);
    };
  }, [carregar]);

  // Menu de mensagem aberto: qualquer toque fora dele (ou Esc) fecha, em qualquer
  // parte da tela — inclusive no painel do grupo e na caixa de digitar.
  useEffect(() => {
    if (!menuDe) return;
    const fora = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu-msg]')) setMenuDe(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuDe(null);
    };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [menuDe]);

  // Rola para o fim quando chega coisa nova — a não ser que a pessoa tenha subido para ler.
  useEffect(() => {
    const el = fundoRef.current;
    if (el && colarNoFim.current) el.scrollTop = el.scrollHeight;
  }, [baloes, naFila]);

  async function carregarAntigas() {
    const prox = pagina + 1;
    colarNoFim.current = false;
    const r = await fetch(`/api/celular/mensagens?${q}&pagina=${prox}`, { cache: 'no-store' }).catch(() => null);
    const b = await r?.json().catch(() => null);
    if (!r?.ok || !b) return;
    setPagina(prox);
    setOrigem((o) => ({ ...o, ...(b.origem ?? {}) }));
    setBaloes((atual) => {
      const mapa = new Map((atual ?? []).map((x) => [x.id, x]));
      for (const x of b.baloes as Balao[]) mapa.set(x.id, x);
      return [...mapa.values()].sort((a, z) => a.ts - z.ts);
    });
  }

  async function salvarEdicao() {
    if (!editando) return;
    setSalvando(true);
    setAviso(null);
    const r =
      editando.tipo === 'enviada'
        ? await fetch('/api/celular/editar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conexao: conexaoId || null, jid: conversa.jid, id: editando.id, texto: editando.texto }),
          }).catch(() => null)
        : await fetch(`/api/campaigns/${editando.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mensagem: editando.texto.trim() }),
          }).catch(() => null);
    const b = await r?.json().catch(() => ({}));
    setSalvando(false);
    if (!r?.ok) {
      setAviso(b?.error ?? 'Não foi possível salvar.');
      return;
    }
    setAviso(
      editando.tipo === 'enviada'
        ? 'Mensagem editada no WhatsApp. Quem recebeu vê o texto novo com a marca “Editada”.'
        : 'Texto da mensagem agendada atualizado.',
    );
    setEditando(null);
    void carregar();
  }

  async function apagar(b: Balao) {
    const pergunta = b.fromMe
      ? 'Apagar esta mensagem para todos? No lugar dela fica “Mensagem apagada”.'
      : `Apagar a mensagem de ${b.autor ?? 'outra pessoa'} para todos? Só funciona se este número for admin do grupo.`;
    if (!window.confirm(pergunta)) return;
    const r = await fetch('/api/celular/apagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conexao: conexaoId || null, jid: conversa.jid, id: b.id, fromMe: b.fromMe, participant: b.participant }),
    }).catch(() => null);
    const corpo = await r?.json().catch(() => ({}));
    setAviso(r?.ok ? 'Mensagem apagada para todos.' : (corpo?.error ?? 'Não foi possível apagar.'));
    void carregar();
  }

  async function reagirA(b: Balao, emoji: string) {
    setMenuDe(null);
    // Tocar de novo na reação que já é minha = tirar a reação (igual ao aparelho).
    const jaEra = b.reacoes.some((r) => r.minha && r.emoji === emoji);
    const r = await fetch('/api/celular/reagir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conexao: conexaoId || null,
        jid: conversa.jid,
        id: b.id,
        fromMe: b.fromMe,
        participant: b.participant,
        emoji: jaEra ? '' : emoji,
      }),
    }).catch(() => null);
    if (!r?.ok) {
      const corpo = await r?.json().catch(() => ({}));
      setAviso(corpo?.error ?? 'Não foi possível reagir.');
      return;
    }
    void carregar();
  }

  function copiar(b: Balao) {
    setMenuDe(null);
    if (!b.texto) return;
    void navigator.clipboard?.writeText(b.texto).then(
      () => setAviso('Texto copiado.'),
      () => setAviso('O navegador não deixou copiar.'),
    );
  }

  const midiaUrl = (id: string) => `/api/celular/midia?conexao=${encodeURIComponent(conexaoId)}&id=${encodeURIComponent(id)}`;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 px-3 py-2.5" style={{ background: WA.barra }}>
          <button
            type="button"
            onClick={onVoltar}
            className="rounded-full px-2 py-1 text-xl leading-none md:hidden"
            aria-label="Voltar para a lista"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => conversa.grupo && setPainel((p) => !p)}
            disabled={!conversa.grupo}
            className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
            title={conversa.grupo ? 'Dados e configurações do grupo' : undefined}
          >
            <Avatar c={conversa} tamanho={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{conversa.nome}</span>
              <span className="block truncate text-[12.5px]" style={{ color: WA.cinza }}>
                {conversa.grupo
                  ? `${conversa.sendflow ? `grupo do SendFlow · ${conversa.ativo ? 'ativo para disparo' : 'inativo para disparo'}` : 'grupo fora do SendFlow'} · toque para ver os dados`
                  : conversa.telefone
                    ? `+${conversa.telefone}`
                    : 'contato'}
              </span>
            </span>
          </button>
          {conversa.grupo && (
            <button
              type="button"
              onClick={() => setPainel((p) => !p)}
              className="rounded-full px-2.5 py-1.5 text-sm transition-colors hover:bg-white/10"
              aria-label="Dados do grupo"
              aria-expanded={painel}
              title="Dados do grupo"
            >
              ⚙
            </button>
          )}
          <button
            type="button"
            onClick={() => void carregar()}
            className="rounded-full px-2.5 py-1.5 text-sm transition-colors hover:bg-white/10"
            aria-label="Atualizar conversa"
            title="Atualizar"
          >
            ⟳
          </button>
        </header>

        <div
          ref={fundoRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            colarNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            // O menu é fixo na tela: rolando a conversa, ele ficaria solto no ar.
            if (menuDe) setMenuDe(null);
          }}
          className="flex-1 overflow-y-auto px-3 py-3 sm:px-[6%]"
          style={{ backgroundColor: WA.fundo, backgroundImage: PAPEL_DE_PAREDE }}
        >
          {pagina < paginas && (
            <div className="mb-3 text-center">
              <button
                type="button"
                onClick={() => void carregarAntigas()}
                className="rounded-full px-3 py-1 text-[12.5px]"
                style={{ background: WA.barra, color: WA.cinza }}
              >
                Carregar mensagens anteriores
              </button>
            </div>
          )}

          {erro && (
            <div className="mx-auto mb-3 max-w-[520px] rounded-lg px-3 py-2 text-center text-[13px]" style={{ background: WA.erroFundo, color: WA.erroTexto }}>
              {erro}
            </div>
          )}

          {baloes === null ? (
            <p className="py-10 text-center text-sm" style={{ color: WA.cinza }}>
              Abrindo conversa…
            </p>
          ) : baloes.length === 0 && !erro ? (
            <p className="py-10 text-center text-sm" style={{ color: WA.cinza }}>
              Nenhuma mensagem guardada nesta conversa.
            </p>
          ) : (
            baloes.map((b, i) => {
              const novoDia = i === 0 || rotuloDoDia(b.ts) !== rotuloDoDia(baloes[i - 1].ts);
              const o = origem[b.id];
              const editavel = podeEditar(b, agoraSeg);
              const emEdicao = editando?.tipo === 'enviada' && editando.id === b.id;
              const menuAberto = menuDe?.id === b.id;
              // Mensagem de outra pessoa só pode ser apagada em grupo (e por admin).
              const apagavel = b.fromMe || (conversa.grupo && Boolean(b.participant));
              return (
                <Fragment key={b.id}>
                  {novoDia && (
                    <div className="my-3 text-center">
                      <span className="rounded-lg px-3 py-1 text-[12px] shadow-sm" style={{ background: '#182229', color: WA.cinza }}>
                        {rotuloDoDia(b.ts)}
                      </span>
                    </div>
                  )}
                  <div className={`flex ${b.reacoes.length ? 'mb-4' : 'mb-1.5'} ${b.fromMe ? 'justify-end' : 'justify-start'}`}>
                    <div
                      data-menu-msg
                      className={`group relative max-w-[88%] rounded-lg px-2 pb-1.5 pt-1 text-[14px] leading-[1.4] shadow-[0_1px_1px_rgba(0,0,0,.25)] sm:max-w-[70%] ${
                        b.fromMe ? 'rounded-tr-none' : 'rounded-tl-none'
                      }`}
                      style={{ background: b.fromMe ? WA.saida : WA.entrada }}
                    >
                      {/* Botão do menu da mensagem: no computador aparece ao passar o mouse. */}
                      {!emEdicao && (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (menuAberto) return setMenuDe(null);
                            // Menu em posição FIXA, ancorado no botão: dentro do balão ele
                            // ficava cortado pela rolagem da conversa. Abre para cima
                            // quando não cabe embaixo.
                            const r = e.currentTarget.getBoundingClientRect();
                            const cabeEmbaixo = window.innerHeight - r.bottom > 300;
                            const left = Math.max(8, Math.min(r.right - 224, window.innerWidth - 232));
                            setMenuDe(
                              cabeEmbaixo
                                ? { id: b.id, left, top: r.bottom + 4 }
                                : { id: b.id, left, bottom: window.innerHeight - r.top + 4 },
                            );
                          }}
                          aria-label="Opções da mensagem"
                          aria-expanded={menuAberto}
                          className={`absolute right-1 top-1 z-10 rounded-full px-1.5 text-[13px] leading-5 transition-opacity md:opacity-0 md:group-hover:opacity-100 ${
                            menuAberto ? 'md:opacity-100' : ''
                          }`}
                          style={{ background: b.fromMe ? WA.saida : WA.entrada, color: WA.cinza }}
                        >
                          ⌄
                        </button>
                      )}

                      {menuAberto && (
                        <div
                          className="fixed z-50 w-56 overflow-hidden rounded-lg shadow-xl"
                          style={{ background: '#233138', left: menuDe.left, top: menuDe.top, bottom: menuDe.bottom }}
                          role="menu"
                        >
                          <div className="flex justify-between px-2 py-2" style={{ background: '#1b262d' }}>
                            {REACOES_RAPIDAS.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => void reagirA(b, e)}
                                className={`rounded-full px-1 text-[20px] leading-7 transition-transform hover:scale-125 ${
                                  b.reacoes.some((r) => r.minha && r.emoji === e) ? 'bg-white/15' : ''
                                }`}
                                aria-label={`Reagir com ${e}`}
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                          <ItemMenu
                            onClick={() => {
                              setRespondendo(b);
                              setMenuDe(null);
                            }}
                          >
                            ↩ Responder
                          </ItemMenu>
                          {b.texto && <ItemMenu onClick={() => copiar(b)}>⧉ Copiar texto</ItemMenu>}
                          {editavel && (
                            <ItemMenu
                              onClick={() => {
                                setEditando({ tipo: 'enviada', id: b.id, texto: b.texto ?? '' });
                                setMenuDe(null);
                              }}
                            >
                              ✏️ Editar
                            </ItemMenu>
                          )}
                          {apagavel && (
                            <ItemMenu
                              perigo
                              onClick={() => {
                                setMenuDe(null);
                                void apagar(b);
                              }}
                            >
                              🗑 Apagar para todos{b.fromMe ? '' : ' (admin)'}
                            </ItemMenu>
                          )}
                        </div>
                      )}

                      {o && (
                        <Link
                          href={`/campanhas/${o.campanha_id}`}
                          className="mb-1 block truncate pr-5 text-[11.5px] font-semibold hover:underline"
                          style={{ color: '#9fe8c9' }}
                        >
                          📣 {o.campanha}
                        </Link>
                      )}
                      {!b.fromMe && conversa.grupo && b.autor && (
                        <div className="mb-0.5 truncate pr-5 text-[12.5px] font-semibold" style={{ color: '#f5a26b' }}>
                          {b.autor}
                        </div>
                      )}

                      {b.citacao && (
                        <button
                          type="button"
                          onClick={() => {
                            const alvo = document.getElementById(`msg-${b.citacao?.id}`);
                            alvo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }}
                          className="mb-1 block w-full rounded-md border-l-4 px-2 py-1 text-left text-[12.5px]"
                          style={{ background: 'rgba(0,0,0,.2)', borderColor: WA.verde, color: '#c5ccd0' }}
                        >
                          <span className="line-clamp-2 whitespace-pre-wrap break-words">{b.citacao.texto}</span>
                        </button>
                      )}

                      <span id={`msg-${b.id}`} />
                      <Midia balao={b} origemUrl={o?.midia_url ?? null} url={midiaUrl(b.id)} />

                      {emEdicao ? (
                        <div className="mt-1">
                          <textarea
                            value={editando.texto}
                            onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                            rows={4}
                            className="w-full min-w-[220px] rounded-md p-2 text-[14px] outline-none"
                            style={{ background: '#0b3d33', color: WA.texto }}
                            autoFocus
                          />
                          <div className="mt-1 flex justify-end gap-2 text-[12.5px]">
                            <button type="button" onClick={() => setEditando(null)} style={{ color: WA.cinza }}>
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => void salvarEdicao()}
                              disabled={salvando}
                              className="rounded-full px-3 py-1 font-semibold"
                              style={{ background: WA.verde, color: WA.fundo }}
                            >
                              {salvando ? 'Salvando…' : 'Salvar edição'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        b.texto && <div className="whitespace-pre-wrap break-words pr-3">{formatar(b.texto)}</div>
                      )}

                      <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px]" style={{ color: b.fromMe ? '#8fb9ae' : WA.cinza }}>
                        {b.editada && <span>Editada</span>}
                        <span>{horaDe(b.ts)}</span>
                        {b.fromMe && <Tiques tique={b.tique} grupo={conversa.grupo} />}
                      </div>

                      {b.reacoes.length > 0 && (
                        <div className={`absolute -bottom-3.5 flex gap-0.5 ${b.fromMe ? 'right-2' : 'left-2'}`}>
                          {b.reacoes.map((r) => (
                            <button
                              key={r.emoji}
                              type="button"
                              onClick={() => void reagirA(b, r.emoji)}
                              title={r.minha ? 'Sua reação — toque para tirar' : 'Reagir igual'}
                              className="flex items-center gap-0.5 rounded-full border px-1.5 text-[12px] leading-5"
                              style={{ background: '#1f2c34', borderColor: r.minha ? WA.verde : WA.fundo }}
                            >
                              {r.emoji}
                              {r.quantos > 1 && <span style={{ color: WA.cinza }}>{r.quantos}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })
          )}

          {naFila.length > 0 && (
            <div className="mt-4">
              <div className="my-3 text-center">
                <span className="rounded-lg px-3 py-1 text-[12px]" style={{ background: '#182229', color: '#d9fdd3' }}>
                  🕓 Na fila para sair nesta conversa
                </span>
              </div>
              {naFila.map((f) => {
                const emEdicao = editando?.tipo === 'fila' && editando.id === f.id;
                const pausada = f.status === 'rascunho';
                return (
                  <div key={f.id} className="mb-2 flex justify-end">
                    <div
                      className="max-w-[88%] rounded-lg rounded-tr-none border border-dashed px-2 pb-1.5 pt-1 text-[14px] leading-[1.4] sm:max-w-[70%]"
                      style={{ background: 'rgba(0,92,75,.35)', borderColor: '#2f8f7a' }}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[11.5px] font-semibold" style={{ color: '#9fe8c9' }}>
                        <span>{pausada ? '⏸ Pausada' : `Sai ${formatWhen(f.enviar_em)}`}</span>
                        <span className="truncate font-normal opacity-80">· {f.nome}</span>
                      </div>
                      {f.tipo === 'imagem' && f.midia_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.midia_url} alt="" className="mb-1 max-h-60 w-full rounded-md object-cover" />
                      )}
                      {(f.tipo === 'video' || f.tipo === 'pdf') && (
                        <div className="mb-1 rounded-md px-2 py-3 text-center text-[12.5px]" style={{ background: 'rgba(0,0,0,.25)' }}>
                          {f.tipo === 'video' ? '🎬 Vídeo' : '📄 PDF'} anexado
                        </div>
                      )}
                      {emEdicao ? (
                        <div>
                          <textarea
                            value={editando.texto}
                            onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                            rows={5}
                            className="w-full min-w-[220px] rounded-md p-2 text-[14px] outline-none"
                            style={{ background: '#0b3d33', color: WA.texto }}
                            autoFocus
                          />
                          <div className="mt-1 flex justify-end gap-2 text-[12.5px]">
                            <button type="button" onClick={() => setEditando(null)} style={{ color: WA.cinza }}>
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => void salvarEdicao()}
                              disabled={salvando}
                              className="rounded-full px-3 py-1 font-semibold"
                              style={{ background: WA.verde, color: WA.fundo }}
                            >
                              {salvando ? 'Salvando…' : 'Salvar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap break-words">
                          {f.mencionar_todos && <span style={{ color: WA.azul }}>@todos </span>}
                          {f.tipo === 'enquete' ? <b>📊 {f.mensagem}</b> : formatar(f.mensagem)}
                          {f.tipo === 'enquete' &&
                            (f.enquete_opcoes ?? []).map((op) => (
                              <span key={op} className="mt-1 flex items-center gap-2">
                                <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2" style={{ borderColor: '#8fb9ae' }} />
                                {op}
                              </span>
                            ))}
                        </div>
                      )}
                      {!emEdicao && f.status !== 'enviando' && (
                        <div className="mt-1 flex flex-wrap justify-end gap-3 border-t border-white/10 pt-1 text-[12px]">
                          <button type="button" onClick={() => setEditando({ tipo: 'fila', id: f.id, texto: f.mensagem })} style={{ color: '#9fe8c9' }}>
                            ✏️ Editar texto
                          </button>
                          <Link href={f.cadencia_id ? `/cadencias/${f.cadencia_id}` : `/campanhas/nova?id=${f.id}`} style={{ color: WA.cinza }}>
                            {f.cadencia_id ? 'Abrir cadência ›' : 'Editar tudo ›'}
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {aviso && (
          <div className="flex items-center gap-3 px-4 py-2.5 text-[13px]" style={{ background: WA.barra }} role="status">
            <span className="min-w-0 flex-1">{aviso}</span>
            <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" style={{ color: WA.cinza }}>
              ×
            </button>
          </div>
        )}

        <Composer
          conexaoId={conexaoId}
          jid={conversa.jid}
          grupo={conversa.grupo}
          respondendo={respondendo}
          onCancelarResposta={() => setRespondendo(null)}
          onEnviou={() => {
            setRespondendo(null);
            colarNoFim.current = true;
            void carregar();
          }}
          onErro={setAviso}
        />
      </div>

      {painel && conversa.grupo && (
        <PainelDoGrupo
          conexaoId={conexaoId}
          jid={conversa.jid}
          grupoId={conversa.grupoId}
          tags={tags}
          tagIds={conversa.tag_ids}
          onTagsChange={onTagsChange}
          onFechar={() => setPainel(false)}
          onMudouNome={onMudouNome}
        />
      )}
    </div>
  );
}

function ItemMenu({ children, onClick, perigo }: { children: React.ReactNode; onClick: () => void; perigo?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-4 py-2.5 text-left text-[13.5px] hover:bg-white/5"
      style={{ color: perigo ? '#f15c6d' : WA.texto }}
    >
      {children}
    </button>
  );
}

const TIPO_POR_MIME: Record<string, 'imagem' | 'video' | 'pdf'> = {
  'image/jpeg': 'imagem',
  'image/png': 'imagem',
  'image/webp': 'imagem',
  'video/mp4': 'video',
  'application/pdf': 'pdf',
};

/** A caixa de digitar do WhatsApp: texto, anexo, @todos e resposta a uma mensagem. */
function Composer({
  conexaoId,
  jid,
  grupo,
  respondendo,
  onCancelarResposta,
  onEnviou,
  onErro,
}: {
  conexaoId: string;
  jid: string;
  grupo: boolean;
  respondendo: Balao | null;
  onCancelarResposta: () => void;
  onEnviou: () => void;
  onErro: (msg: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const [anexo, setAnexo] = useState<{ url: string; tipo: 'imagem' | 'video' | 'pdf'; nome: string } | null>(null);
  const [todos, setTodos] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (respondendo) campo.current?.focus();
  }, [respondendo]);

  async function anexar(arquivo: File) {
    const tipo = TIPO_POR_MIME[arquivo.type];
    if (!tipo) {
      onErro('Anexe foto (JPG/PNG/WEBP), vídeo MP4 ou PDF.');
      return;
    }
    setSubindo(true);
    const r = await uploadMedia(arquivo);
    setSubindo(false);
    if ('error' in r) {
      onErro(r.error);
      return;
    }
    setAnexo({ url: r.url, tipo, nome: arquivo.name });
  }

  async function enviar() {
    const t = texto.trim();
    if ((!t && !anexo) || enviando) return;
    setEnviando(true);
    const r = await fetch('/api/celular/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conexao: conexaoId || null,
        jid,
        tipo: anexo?.tipo ?? 'texto',
        texto: t,
        midiaUrl: anexo?.url ?? null,
        mencionarTodos: grupo && todos,
        citacao: respondendo
          ? { id: respondendo.id, fromMe: respondendo.fromMe, participant: respondendo.participant, texto: respondendo.texto }
          : null,
      }),
    }).catch(() => null);
    const b = await r?.json().catch(() => ({}));
    setEnviando(false);
    if (!r?.ok) {
      onErro(b?.error ?? 'Não foi possível enviar.');
      return;
    }
    setTexto('');
    setAnexo(null);
    setTodos(false);
    onEnviou();
  }

  return (
    <div style={{ background: WA.barra }}>
      {respondendo && (
        <div className="flex items-start gap-2 px-3 pt-2">
          <div className="min-w-0 flex-1 rounded-md border-l-4 px-2 py-1.5 text-[12.5px]" style={{ background: WA.lista, borderColor: WA.verde }}>
            <div className="font-semibold" style={{ color: WA.verde }}>
              {respondendo.fromMe ? 'Você' : (respondendo.autor ?? 'Contato')}
            </div>
            <div className="truncate" style={{ color: WA.cinza }}>
              {respondendo.texto ?? 'Mídia'}
            </div>
          </div>
          <button type="button" onClick={onCancelarResposta} aria-label="Cancelar resposta" className="px-1 text-lg" style={{ color: WA.cinza }}>
            ×
          </button>
        </div>
      )}
      {anexo && (
        <div className="flex items-center gap-2 px-3 pt-2 text-[12.5px]">
          {anexo.tipo === 'imagem' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={anexo.url} alt="" className="h-12 w-12 rounded object-cover" />
          ) : (
            <span className="rounded px-2 py-1" style={{ background: WA.lista }}>
              {anexo.tipo === 'video' ? '🎬' : '📄'}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{anexo.nome}</span>
          <button type="button" onClick={() => setAnexo(null)} aria-label="Tirar anexo" className="px-1 text-lg" style={{ color: WA.cinza }}>
            ×
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5 px-2 py-2">
        <label
          className={`shrink-0 cursor-pointer rounded-full px-2.5 py-2 text-lg leading-none hover:bg-white/10 ${subindo ? 'animate-pulse' : ''}`}
          title="Anexar foto, vídeo ou PDF"
        >
          📎<span className="sr-only">Anexar arquivo</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf"
            className="sr-only"
            disabled={subindo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void anexar(f);
            }}
          />
        </label>
        {grupo && (
          <button
            type="button"
            onClick={() => setTodos((v) => !v)}
            aria-pressed={todos}
            title="Mencionar todos do grupo (@todos)"
            className="shrink-0 rounded-full px-2 py-2 text-[13px] font-semibold leading-none"
            style={todos ? { background: '#0a332c', color: WA.azul } : { color: WA.cinza }}
          >
            @
          </button>
        )}
        <textarea
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia, Shift+Enter quebra linha — como no WhatsApp Web.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void enviar();
            }
          }}
          rows={1}
          placeholder={anexo ? 'Legenda (opcional)' : 'Digite uma mensagem'}
          aria-label="Mensagem"
          className="max-h-40 min-h-[40px] min-w-0 flex-1 resize-none rounded-lg px-3 py-2.5 text-[14.5px] outline-none placeholder:text-[#8696a0]"
          style={{ background: '#2a3942', color: WA.texto, fieldSizing: 'content' } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={enviando || subindo || (!texto.trim() && !anexo)}
          aria-label="Enviar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition-opacity disabled:cursor-not-allowed"
          style={{ background: texto.trim() || anexo ? WA.verde : 'transparent', color: texto.trim() || anexo ? WA.fundo : WA.cinza }}
        >
          {enviando ? '…' : '➤'}
        </button>
      </div>
    </div>
  );
}

/** Mídia do balão. A nossa vem do Storage na hora; a dos outros só carrega ao tocar. */
function Midia({ balao, origemUrl, url }: { balao: Balao; origemUrl: string | null; url: string }) {
  const [mostrar, setMostrar] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const { tipo } = balao;
  if (!['imagem', 'video', 'audio', 'documento', 'figurinha'].includes(tipo)) {
    if (tipo === 'enquete' || tipo === 'contato' || tipo === 'localizacao' || tipo === 'outro') {
      return (
        <div className="mb-0.5 text-[12.5px] italic" style={{ color: '#aebac1' }}>
          {tipo === 'enquete' ? '📊 Enquete' : tipo === 'contato' ? '👤 Contato' : tipo === 'localizacao' ? '📍 Localização' : 'Mensagem sem prévia'}
        </div>
      );
    }
    return null;
  }

  if (tipo === 'imagem' && origemUrl && !falhou) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={origemUrl} alt="" onError={() => setFalhou(true)} className="mb-1 max-h-72 w-full rounded-md object-cover" />;
  }

  if (tipo === 'documento') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mb-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px]"
        style={{ background: 'rgba(0,0,0,.2)' }}
      >
        📄 <span className="truncate">{balao.arquivo ?? 'Documento'}</span>
      </a>
    );
  }

  if (!mostrar) {
    const rotulo = { imagem: '📷 Ver foto', video: '🎬 Ver vídeo', audio: '🎤 Ouvir áudio', figurinha: '💟 Ver figurinha' }[
      tipo as 'imagem' | 'video' | 'audio' | 'figurinha'
    ];
    return (
      <button
        type="button"
        onClick={() => setMostrar(true)}
        className="mb-1 block w-full min-w-[180px] rounded-md px-3 py-4 text-center text-[13px]"
        style={{ background: 'rgba(0,0,0,.22)', color: '#d1d7db' }}
      >
        {rotulo}
      </button>
    );
  }
  if (falhou) {
    return (
      <div className="mb-1 rounded-md px-3 py-3 text-center text-[12.5px]" style={{ background: 'rgba(0,0,0,.22)', color: WA.cinza }}>
        Mídia indisponível (o WhatsApp já apagou do servidor)
      </div>
    );
  }
  if (tipo === 'video') {
    return <video src={url} controls onError={() => setFalhou(true)} className="mb-1 max-h-72 w-full rounded-md" />;
  }
  if (tipo === 'audio') {
    return <audio src={url} controls onError={() => setFalhou(true)} className="mb-1 w-[240px] max-w-full" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" onError={() => setFalhou(true)} className={`mb-1 rounded-md ${tipo === 'figurinha' ? 'h-32 w-32' : 'max-h-72 w-full object-cover'}`} />;
}
