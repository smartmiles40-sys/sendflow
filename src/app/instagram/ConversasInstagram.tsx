'use client';

// Caixa de entrada do Instagram: conversas à esquerda, mensagens à direita, resposta
// embaixo. Responder à mão pausa o robô 12 h naquela conversa.

import { useEffect, useRef, useState } from 'react';
import { inputCls } from '@/components/ui';
import { janelaAberta } from '@/lib/instagram/regras';

interface Conversa {
  id: string;
  igsid: string;
  username: string | null;
  nome: string | null;
  tags: string[];
  ultima_entrada_em: string | null;
  ultima_mensagem_em: string | null;
  ultima_previa: string | null;
  nao_lidas: number;
  automacao_pausada_ate: string | null;
}

interface Mensagem {
  id: string;
  direcao: 'entrada' | 'saida';
  tipo: string;
  texto: string | null;
  status: string;
  erro: string | null;
  origem: string;
  criado_em: string;
}

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export function ConversasInstagram({ contaId }: { contaId: string }) {
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [aberta, setAberta] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const fim = useRef<HTMLDivElement>(null);
  // O relógio da tela (janela de 24 h, robô pausado) anda de minuto em minuto.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // A lista se atualiza a cada 15 s — sem tempo real, mas sem precisar recarregar a página.
  useEffect(() => {
    let vivo = true;
    const carregar = () =>
      fetch(`/api/instagram/conversas?conta=${contaId}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (vivo && b) setConversas(b.conversas ?? []);
        })
        .catch(() => {});
    void carregar();
    const t = setInterval(carregar, 15_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [contaId, versao]);

  useEffect(() => {
    if (!aberta) return;
    let vivo = true;
    const carregar = () =>
      fetch(`/api/instagram/conversas/${aberta.id}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (!vivo || !b) return;
          setMensagens(b.mensagens ?? []);
          setAberta((a) => (a && a.id === b.conversa.id ? { ...a, ...b.conversa } : a));
        })
        .catch(() => {});
    void carregar();
    const t = setInterval(carregar, 8_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [aberta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [mensagens.length]);

  async function enviar() {
    if (!aberta || !texto.trim()) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/instagram/conversas/${aberta.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(b.error ?? 'Não consegui enviar.');
      setTexto('');
      setVersao((v) => v + 1);
      const f = await fetch(`/api/instagram/conversas/${aberta.id}`).then((x) => x.json()).catch(() => null);
      if (f?.mensagens) setMensagens(f.mensagens);
    } finally {
      setEnviando(false);
    }
  }

  async function pausar(p: boolean) {
    if (!aberta) return;
    const r = await fetch(`/api/instagram/conversas/${aberta.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pausar: p }),
    });
    const b = await r.json().catch(() => ({}));
    if (r.ok) setAberta({ ...aberta, automacao_pausada_ate: b.automacao_pausada_ate });
  }

  if (!conversas) return <p className="text-sm text-muted">Carregando conversas…</p>;

  const pausado = Boolean(aberta?.automacao_pausada_ate && Date.parse(aberta.automacao_pausada_ate) > agora.getTime());
  const podeResponder = janelaAberta(aberta?.ultima_entrada_em, agora);

  return (
    <div className="grid min-h-[520px] overflow-hidden rounded-xl2 border border-border bg-surface md:grid-cols-[300px_1fr]">
      <div className={`border-border md:border-r ${aberta ? 'hidden md:block' : ''}`}>
        {conversas.length === 0 ? (
          <p className="p-5 text-sm text-muted">Nenhuma conversa ainda. Elas aparecem quando alguém manda DM, responde um story ou recebe a DM de um comentário.</p>
        ) : (
          <ul className="max-h-[640px] overflow-y-auto">
            {conversas.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAberta(c);
                    setMensagens([]);
                    setErro(null);
                  }}
                  className={`flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-white/[0.03] ${aberta?.id === c.id ? 'bg-blue/10' : ''}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.nome || (c.username ? `@${c.username}` : 'Sem nome')}</span>
                    {c.nao_lidas > 0 && <span className="rounded-full bg-blue px-1.5 text-[10px] font-bold text-on-blue">{c.nao_lidas}</span>}
                  </span>
                  <span className="truncate text-xs text-muted">{c.ultima_previa}</span>
                  <span className="text-[10px] text-muted/80">{hora(c.ultima_mensagem_em)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`flex flex-col ${aberta ? '' : 'hidden md:flex'}`}>
        {!aberta ? (
          <p className="m-auto p-6 text-sm text-muted">Escolha uma conversa.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <button type="button" onClick={() => setAberta(null)} className="text-xs font-semibold text-muted md:hidden">
                ←
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{aberta.nome || `@${aberta.username ?? ''}`}</div>
                {aberta.username && (
                  <a href={`https://instagram.com/${aberta.username}`} target="_blank" rel="noreferrer" className="text-xs text-muted hover:underline">
                    @{aberta.username}
                  </a>
                )}
              </div>
              {aberta.tags?.length > 0 && <span className="text-xs text-muted">🏷️ {aberta.tags.join(', ')}</span>}
              <button
                type="button"
                onClick={() => void pausar(!pausado)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-ink"
              >
                {pausado ? '▶ Religar robô' : '⏸ Pausar robô'}
              </button>
            </div>
            <div className="flex max-h-[480px] flex-1 flex-col gap-2 overflow-y-auto p-4">
              {mensagens.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                    m.direcao === 'entrada' ? 'self-start bg-surface2' : m.status === 'falha' ? 'self-end border border-orange/40 bg-orange/10' : 'self-end bg-blue/15'
                  }`}
                >
                  {m.tipo === 'story_mencao' && <div className="mb-1 text-[10px] font-semibold uppercase text-muted">menção no story</div>}
                  {m.tipo === 'story_resposta' && <div className="mb-1 text-[10px] font-semibold uppercase text-muted">resposta ao story</div>}
                  {m.tipo === 'resposta_privada' && <div className="mb-1 text-[10px] font-semibold uppercase text-muted">resposta ao comentário</div>}
                  <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                  <div className="mt-1 text-[10px] text-muted">
                    {hora(m.criado_em)}
                    {m.origem === 'automacao' && ' · 🤖 robô'}
                    {m.origem === 'eco' && ' · pelo app'}
                    {m.status === 'falha' && <span className="text-[#ffb183]"> · falhou: {m.erro}</span>}
                  </div>
                </div>
              ))}
              <div ref={fim} />
            </div>
            <div className="border-t border-border p-3">
              {erro && <p className="mb-2 text-xs text-[#ffb183]">{erro}</p>}
              {podeResponder ? (
                <div className="flex gap-2">
                  <input
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void enviar();
                      }
                    }}
                    placeholder="Responder… (pausa o robô por 12 h nesta conversa)"
                    aria-label="Mensagem"
                    className={`${inputCls} !py-2.5 flex-1 text-[13px]`}
                  />
                  <button
                    type="button"
                    onClick={() => void enviar()}
                    disabled={enviando || !texto.trim()}
                    className="rounded-xl bg-blue px-4 text-sm font-semibold text-on-blue disabled:bg-surface2 disabled:text-muted"
                  >
                    {enviando ? '…' : 'Enviar'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  Passou de 24 h desde a última mensagem desta pessoa — o Instagram só libera responder depois que ela escrever de novo.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
