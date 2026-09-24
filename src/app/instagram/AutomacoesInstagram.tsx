'use client';

// As automações do Instagram: lista (liga/desliga, quantas vezes disparou) e o
// formulário de criar/editar — gatilho, palavras, posts, resposta pública e a DM.

import { useEffect, useState } from 'react';
import { inputCls } from '@/components/ui';
import { formatarNumero } from '@/lib/kpis';
import { ROTULO_GATILHO, validarAutomacao, type AutomacaoIg, type BotaoLink, type GatilhoIg } from '@/lib/instagram/regras';

interface Linha extends AutomacaoIg {
  disparos: number;
  ultimo_disparo_em: string | null;
}

interface Midia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
}

const VAZIA = {
  nome: '',
  gatilho: 'comentario' as GatilhoIg,
  palavras: '',
  qualquer: false,
  posts: [] as string[],
  publicas: '',
  dm: '',
  botoes: [] as BotaoLink[],
  tags: '',
};

type Form = typeof VAZIA;

function paraForm(a: AutomacaoIg): Form {
  return {
    nome: a.nome,
    gatilho: a.gatilho,
    palavras: (a.config.palavras ?? []).join(', '),
    qualquer: Boolean(a.config.qualquer_palavra),
    posts: a.config.posts ?? [],
    publicas: (a.config.respostas_publicas ?? []).join('\n'),
    dm: a.config.dm_texto ?? '',
    botoes: a.config.dm_botoes ?? [],
    tags: (a.config.tags ?? []).join(', '),
  };
}

function paraCorpo(f: Form) {
  return {
    nome: f.nome,
    gatilho: f.gatilho,
    config: {
      palavras: f.palavras,
      qualquer_palavra: f.qualquer,
      posts: f.posts,
      respostas_publicas: f.publicas,
      dm_texto: f.dm,
      dm_botoes: f.botoes,
      tags: f.tags,
    },
  };
}

export function AutomacoesInstagram({ contaId }: { contaId: string }) {
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [editando, setEditando] = useState<{ id: string | null; form: Form } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/instagram/automacoes?conta=${contaId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (vivo) setLista(b?.automacoes ?? []);
      })
      .catch(() => {
        if (vivo) setLista([]);
      });
    return () => {
      vivo = false;
    };
  }, [contaId, versao]);

  async function alternar(a: Linha) {
    setErro(null);
    const r = await fetch(`/api/instagram/automacoes/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ativo: !a.ativo }),
    });
    if (!r.ok) return setErro('Não consegui mudar.');
    setLista((l) => (l ?? []).map((x) => (x.id === a.id ? { ...x, ativo: !a.ativo } : x)));
  }

  async function apagar(a: Linha) {
    if (!window.confirm(`Apagar "${a.nome}"?`)) return;
    await fetch(`/api/instagram/automacoes/${a.id}`, { method: 'DELETE' });
    setVersao((v) => v + 1);
  }

  if (editando) {
    return (
      <Editor
        contaId={contaId}
        id={editando.id}
        inicial={editando.form}
        onFechar={(salvou) => {
          setEditando(null);
          if (salvou) setVersao((v) => v + 1);
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Quando mais de uma casa, ganha a mais específica: a de um post escolhido antes da de &quot;todos os posts&quot;, e a de
          palavra antes da de &quot;qualquer texto&quot;.
        </p>
        <button
          type="button"
          onClick={() => setEditando({ id: null, form: VAZIA })}
          className="rounded-xl bg-blue px-4 py-2.5 text-sm font-semibold text-on-blue hover:bg-blue-hover"
        >
          ＋ Nova automação
        </button>
      </div>
      {erro && <p className="mb-3 text-sm text-[#ffb183]">{erro}</p>}
      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {!lista ? (
          <p className="p-6 text-sm text-muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <div className="p-6 text-sm leading-relaxed text-muted">
            Nenhuma automação ainda. A mais usada: <b className="text-ink">Comentário em post</b> com a palavra &quot;EU QUERO&quot; → o
            robô responde &quot;Te mandei na DM! 📩&quot; no comentário e envia o link do roteiro na mensagem privada.
          </div>
        ) : (
          lista.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3.5 first:border-t-0">
              <button
                type="button"
                role="switch"
                aria-checked={a.ativo}
                aria-label={a.ativo ? 'Desligar' : 'Ligar'}
                onClick={() => void alternar(a)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${a.ativo ? 'bg-blue' : 'bg-surface2'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${a.ativo ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
              <button type="button" onClick={() => setEditando({ id: a.id, form: paraForm(a) })} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium hover:underline">{a.nome}</div>
                <div className="truncate text-xs text-muted">
                  {ROTULO_GATILHO[a.gatilho]}
                  {(a.config.palavras ?? []).length ? ` · ${(a.config.palavras ?? []).join(', ')}` : a.config.qualquer_palavra ? ' · qualquer texto' : ''}
                  {(a.config.posts ?? []).length ? ` · ${(a.config.posts ?? []).length} post(s)` : ''}
                </div>
              </button>
              <span className="shrink-0 text-xs tabular-nums text-muted">{formatarNumero(a.disparos)} disparos</span>
              <button
                type="button"
                onClick={() => void apagar(a)}
                aria-label={`Apagar ${a.nome}`}
                className="shrink-0 rounded-lg border border-border p-2 text-sm text-muted hover:text-[#ffb183]"
              >
                🗑
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Editor({
  contaId,
  id,
  inicial,
  onFechar,
}: {
  contaId: string;
  id: string | null;
  inicial: Form;
  onFechar: (salvou: boolean) => void;
}) {
  const [f, setF] = useState<Form>(inicial);
  const [midias, setMidias] = useState<Midia[] | null>(null);
  const [erroMidias, setErroMidias] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const ehComentario = f.gatilho === 'comentario';
  const pedePalavra = f.gatilho === 'comentario' || f.gatilho === 'dm_palavra' || f.gatilho === 'story_resposta';

  useEffect(() => {
    if (!ehComentario || midias) return;
    let vivo = true;
    fetch(`/api/instagram/midias?conta=${contaId}`, { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (r.ok) setMidias(b.midias ?? []);
        else setErroMidias(b.error ?? 'Não consegui carregar os posts.');
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [ehComentario, contaId, midias]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar() {
    const corpo = paraCorpo(f);
    const v = validarAutomacao(corpo);
    if (!v.ok) return setErro(v.erro);
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(id ? `/api/instagram/automacoes/${id}` : '/api/instagram/automacoes', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...corpo, conta_id: contaId }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(b.error ?? 'Não consegui salvar.');
      onFechar(true);
    } finally {
      setSalvando(false);
    }
  }

  const rotulo = 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-muted';

  return (
    <div className="flex flex-col gap-4 rounded-xl2 border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{id ? 'Editar automação' : 'Nova automação'}</h2>
        <button type="button" onClick={() => onFechar(false)} className="text-xs font-semibold text-muted hover:text-ink">
          ← Voltar
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className={rotulo}>Nome</span>
          <input value={f.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Roteiro Japão no comentário" className={inputCls} />
        </label>
        <label className="text-sm">
          <span className={rotulo}>Quando</span>
          <select value={f.gatilho} onChange={(e) => set('gatilho', e.target.value as GatilhoIg)} className={inputCls}>
            {(Object.keys(ROTULO_GATILHO) as GatilhoIg[]).map((g) => (
              <option key={g} value={g}>
                {ROTULO_GATILHO[g]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {pedePalavra && (
        <div>
          <label className="text-sm">
            <span className={rotulo}>Palavras-chave (vírgula separa)</span>
            <input
              value={f.palavras}
              onChange={(e) => set('palavras', e.target.value)}
              disabled={f.qualquer}
              placeholder="eu quero, roteiro, japão"
              className={inputCls}
            />
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.qualquer} onChange={(e) => set('qualquer', e.target.checked)} className="h-4 w-4 accent-[#D7F264]" />
            Responder qualquer texto
          </label>
          <p className="mt-1 text-xs text-muted">Maiúscula, acento e pontuação não importam. A palavra precisa aparecer inteira (&quot;eu&quot; não casa com &quot;Europa&quot;).</p>
        </div>
      )}

      {ehComentario && (
        <div>
          <span className={rotulo}>Em quais posts</span>
          <p className="mb-2 text-xs text-muted">Nenhum marcado = todos os posts e reels (inclusive os que você publicar depois).</p>
          {erroMidias && <p className="text-xs text-[#ffb183]">{erroMidias}</p>}
          {!midias && !erroMidias && <p className="text-xs text-muted">Carregando posts…</p>}
          {midias && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {midias.map((m) => {
                const marcado = f.posts.includes(m.id);
                const img = m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => set('posts', marcado ? f.posts.filter((x) => x !== m.id) : [...f.posts, m.id])}
                    aria-pressed={marcado}
                    title={m.caption?.slice(0, 120) ?? ''}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 ${marcado ? 'border-blue' : 'border-transparent opacity-70 hover:opacity-100'}`}
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={m.caption?.slice(0, 60) ?? 'post'} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center bg-surface2 text-xs text-muted">{m.media_type}</span>
                    )}
                    {marcado && <span className="absolute right-1 top-1 rounded-full bg-blue px-1.5 text-xs font-bold text-on-blue">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {ehComentario && (
        <label className="text-sm">
          <span className={rotulo}>Resposta pública no comentário (uma por linha — sorteia)</span>
          <textarea
            value={f.publicas}
            onChange={(e) => set('publicas', e.target.value)}
            rows={3}
            placeholder={'Te mandei na DM! 📩\nAcabei de te enviar, confere o direct 💌'}
            className={`${inputCls} resize-y`}
          />
          <span className="mt-1 block text-xs text-muted">Variar o texto evita que o Instagram trate as respostas como spam.</span>
        </label>
      )}

      <label className="text-sm">
        <span className={rotulo}>Mensagem na DM</span>
        <textarea
          value={f.dm}
          onChange={(e) => set('dm', e.target.value)}
          rows={4}
          placeholder="Oi {{nome}}! Aqui está o roteiro completo da expedição 👇"
          className={`${inputCls} resize-y`}
        />
        <span className="mt-1 block text-xs text-muted">
          {'{{nome}}'} vira o primeiro nome da pessoa. {ehComentario && 'No comentário, a DM sai uma vez por comentário, até 7 dias depois dele.'}
        </span>
      </label>

      <div>
        <span className={rotulo}>Botões com link (até 3)</span>
        {f.botoes.map((b, i) => (
          <div key={i} className="mb-2 flex flex-wrap gap-2">
            <input
              value={b.titulo}
              onChange={(e) => set('botoes', f.botoes.map((x, j) => (j === i ? { ...x, titulo: e.target.value.slice(0, 20) } : x)))}
              placeholder="Ver roteiro"
              aria-label="Título do botão"
              className={`${inputCls} !py-2 w-40 text-[13px]`}
            />
            <input
              value={b.url}
              onChange={(e) => set('botoes', f.botoes.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))}
              placeholder="https://…"
              aria-label="Link do botão"
              className={`${inputCls} !py-2 min-w-[200px] flex-1 text-[13px]`}
            />
            <button type="button" onClick={() => set('botoes', f.botoes.filter((_, j) => j !== i))} aria-label="Tirar botão" className="px-2 text-muted hover:text-[#ffb183]">
              ✕
            </button>
          </div>
        ))}
        {f.botoes.length < 3 && (
          <button
            type="button"
            onClick={() => set('botoes', [...f.botoes, { titulo: '', url: '' }])}
            className="rounded-xl border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-blue2 hover:text-ink"
          >
            ＋ Botão
          </button>
        )}
      </div>

      <label className="text-sm">
        <span className={rotulo}>Marcar a conversa com as tags (vírgula separa)</span>
        <input value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="interesse-japao" className={inputCls} />
      </label>

      {erro && (
        <p role="alert" className="text-sm text-[#ffb183]">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando}
          className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted"
        >
          {salvando ? 'Salvando…' : 'Salvar automação'}
        </button>
        <button type="button" onClick={() => onFechar(false)} className="rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted hover:text-ink">
          Cancelar
        </button>
      </div>
    </div>
  );
}
