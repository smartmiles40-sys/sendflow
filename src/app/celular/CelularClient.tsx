'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection } from '@/lib/types';
import { podeEditar, type Balao, type Conversa, type Tique } from '@/lib/whatsapp/conversas';
import { formatWhen } from '@/lib/format';

// Paleta do WhatsApp Web no modo escuro — de propósito diferente do resto do painel:
// a tela tem que ser reconhecida na hora como "o celular".
const WA = {
  fundo: '#0b141a',
  barra: '#202c33',
  lista: '#111b21',
  hover: '#202c33',
  selecionada: '#2a3942',
  saida: '#005c4b',
  entrada: '#202c33',
  texto: '#e9edef',
  cinza: '#8696a0',
  azul: '#53bdeb',
  verde: '#00a884',
};

const PAPEL_DE_PAREDE =
  "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"40\" height=\"40\"><circle cx=\"4\" cy=\"4\" r=\"1\" fill=\"%23131f27\"/></svg>')";

type ConversaTela = Conversa & { sendflow: boolean; ativo: boolean; naFila: boolean };
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
      if (q && !c.nome.toLowerCase().includes(q) && !(c.telefone ?? '').includes(q)) return false;
      return true;
    });
  }, [conversas, filtro, busca]);

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
            <ConversaAberta key={aberta.jid} conversa={aberta} conexaoId={conexaoId} onVoltar={() => setAberta(null)} />
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
  onVoltar,
}: {
  conversa: ConversaTela;
  conexaoId: string;
  onVoltar: () => void;
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
  const fundoRef = useRef<HTMLDivElement>(null);
  const colarNoFim = useRef(true);

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
    } catch {
      setErro('Sem conexão com o servidor.');
      setBaloes((x) => x ?? []);
    } finally {
      setAgoraSeg(Math.floor(Date.now() / 1000));
    }
  }, [q]);

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

  async function apagar(id: string) {
    if (!window.confirm('Apagar esta mensagem para todos? No lugar dela fica “Mensagem apagada”.')) return;
    const r = await fetch('/api/celular/apagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conexao: conexaoId || null, jid: conversa.jid, id }),
    }).catch(() => null);
    const b = await r?.json().catch(() => ({}));
    setAviso(r?.ok ? 'Mensagem apagada para todos.' : (b?.error ?? 'Não foi possível apagar.'));
    void carregar();
  }

  const midiaUrl = (id: string) => `/api/celular/midia?conexao=${encodeURIComponent(conexaoId)}&id=${encodeURIComponent(id)}`;

  return (
    <>
      <header className="flex items-center gap-3 px-3 py-2.5" style={{ background: WA.barra }}>
        <button
          type="button"
          onClick={onVoltar}
          className="rounded-full px-2 py-1 text-xl leading-none md:hidden"
          aria-label="Voltar para a lista"
        >
          ←
        </button>
        <Avatar c={conversa} tamanho={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{conversa.nome}</div>
          <div className="truncate text-[12.5px]" style={{ color: WA.cinza }}>
            {conversa.grupo
              ? conversa.sendflow
                ? `grupo do SendFlow · ${conversa.ativo ? 'ativo para disparo' : 'inativo para disparo'}`
                : 'grupo fora do SendFlow'
              : conversa.telefone
                ? `+${conversa.telefone}`
                : 'contato'}
          </div>
        </div>
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
          <div className="mx-auto mb-3 max-w-[520px] rounded-lg px-3 py-2 text-center text-[13px]" style={{ background: '#3b1d22', color: '#f7b5bd' }}>
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
            return (
              <Fragment key={b.id}>
                {novoDia && (
                  <div className="my-3 text-center">
                    <span className="rounded-lg px-3 py-1 text-[12px] shadow-sm" style={{ background: '#182229', color: WA.cinza }}>
                      {rotuloDoDia(b.ts)}
                    </span>
                  </div>
                )}
                <div className={`mb-1.5 flex ${b.fromMe ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`group relative max-w-[88%] rounded-lg px-2 pb-1.5 pt-1 text-[14px] leading-[1.4] shadow-[0_1px_1px_rgba(0,0,0,.25)] sm:max-w-[70%] ${
                      b.fromMe ? 'rounded-tr-none' : 'rounded-tl-none'
                    }`}
                    style={{ background: b.fromMe ? WA.saida : WA.entrada }}
                  >
                    {o && (
                      <Link
                        href={`/campanhas/${o.campanha_id}`}
                        className="mb-1 block truncate text-[11.5px] font-semibold hover:underline"
                        style={{ color: '#9fe8c9' }}
                      >
                        📣 {o.campanha}
                      </Link>
                    )}
                    {!b.fromMe && conversa.grupo && b.autor && (
                      <div className="mb-0.5 truncate text-[12.5px] font-semibold" style={{ color: '#f5a26b' }}>
                        {b.autor}
                      </div>
                    )}

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
                      b.texto && <div className="whitespace-pre-wrap break-words">{formatar(b.texto)}</div>
                    )}

                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px]" style={{ color: b.fromMe ? '#8fb9ae' : WA.cinza }}>
                      {b.editada && <span>Editada</span>}
                      <span>{horaDe(b.ts)}</span>
                      {b.fromMe && <Tiques tique={b.tique} grupo={conversa.grupo} />}
                    </div>

                    {b.fromMe && !emEdicao && (
                      <div className="mt-1 flex justify-end gap-3 border-t border-white/10 pt-1 text-[12px] md:hidden md:group-hover:flex">
                        {editavel && (
                          <button
                            type="button"
                            onClick={() => setEditando({ tipo: 'enviada', id: b.id, texto: b.texto ?? '' })}
                            style={{ color: '#9fe8c9' }}
                          >
                            ✏️ Editar
                          </button>
                        )}
                        <button type="button" onClick={() => void apagar(b.id)} style={{ color: '#f7b5bd' }}>
                          🗑 Apagar para todos
                        </button>
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
                    {f.tipo !== 'texto' && f.tipo !== 'imagem' && (
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
                        {formatar(f.mensagem)}
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
        <div className="flex items-center gap-3 px-4 py-2.5 text-[13px]" style={{ background: WA.barra }}>
          <span className="min-w-0 flex-1">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" style={{ color: WA.cinza }}>
            ×
          </button>
        </div>
      )}
    </>
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
