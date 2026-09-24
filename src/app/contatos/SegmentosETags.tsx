'use client';

// As abas Segmentos e Tags da tela de Contatos.
//
// Segmento = filtro salvo (o "Segment" do ActiveCampaign). O número ao lado é de AGORA:
// segmento não é uma foto da base, é uma pergunta que o banco responde de novo a cada vez.

import { useEffect, useState } from 'react';
import { inputCls } from '@/components/ui';
import { formatarNumero } from '@/lib/kpis';
import { definicaoDoCampo, operador, type Condicao, type Regras } from '@/lib/segmentos';
import type { OpcoesSegmento } from '@/components/RegrasSegmento';

export interface Segmento {
  id: string;
  nome: string;
  descricao: string | null;
  regras: Regras;
  total: number;
}

/** "Tag tem vip e Abertura de e-mail abriu algum e-mail nos últimos 30 dias". */
function resumir(regras: Regras, opcoes: OpcoesSegmento): string {
  const partes = regras.condicoes
    .filter((c): c is Condicao => !('condicoes' in c))
    .map((c) => {
      const campo = definicaoDoCampo(c.campo)?.rotulo ?? c.campo;
      const op = operador(c.campo, c.op);
      let valor = c.valor ?? '';
      if (op?.valor === 'lista') valor = opcoes.listas.find((l) => l.id === valor)?.nome ?? 'lista apagada';
      if (op?.valor === 'campanha') valor = opcoes.campanhas.find((x) => x.id === valor)?.nome ?? 'campanha apagada';
      if (op?.valor === 'dias') valor = `${valor} dias`;
      const chave = c.campo === 'campo' ? ` (${opcoes.campos.find((f) => f.chave === c.chave)?.rotulo ?? c.chave})` : '';
      return `${campo}${chave} ${op?.rotulo ?? c.op}${valor ? ` ${valor}` : ''}`;
    });
  return partes.join(regras.combinar === 'todas' ? ' e ' : ' ou ');
}

export function Segmentos({ opcoes, onAbrir }: { opcoes: OpcoesSegmento; onAbrir: (s: Segmento) => void }) {
  const [segmentos, setSegmentos] = useState<Segmento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/segments', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (vivo) setSegmentos(b?.segmentos ?? []);
      })
      .catch(() => {
        if (vivo) setSegmentos([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  async function apagar(s: Segmento) {
    if (!window.confirm(`Apagar o segmento "${s.nome}"? Os contatos continuam — só o filtro salvo some.`)) return;
    setErro(null);
    const r = await fetch(`/api/segments/${s.id}`, { method: 'DELETE' });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setErro(b.error ?? 'Não consegui apagar.');
    setSegmentos((lista) => (lista ?? []).filter((x) => x.id !== s.id));
  }

  if (!segmentos) return <p className="text-sm text-muted">Carregando segmentos…</p>;

  return (
    <div>
      {erro && (
        <p role="alert" className="mb-3 text-sm text-[#ffb183]">
          {erro}
        </p>
      )}
      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {segmentos.length === 0 ? (
          <p className="p-6 text-sm leading-relaxed text-muted">
            Nenhum segmento ainda. Na aba <b className="text-ink">Contatos</b>, abra o <b className="text-ink">Filtro avançado</b>,
            monte as condições (ex.: tem a tag &quot;live-japao&quot; e abriu algum e-mail nos últimos 30 dias) e clique em{' '}
            <b className="text-ink">Salvar como segmento</b>. Depois ele vira público de campanha de e-mail.
          </p>
        ) : (
          segmentos.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3.5 first:border-t-0">
              <button type="button" onClick={() => onAbrir(s)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium hover:underline">{s.nome}</div>
                <div className="truncate text-xs text-muted">{resumir(s.regras, opcoes)}</div>
              </button>
              <span className="shrink-0 text-xs tabular-nums text-muted">{formatarNumero(s.total)} contatos</span>
              <button
                type="button"
                onClick={() => void apagar(s)}
                aria-label={`Apagar ${s.nome}`}
                className="shrink-0 rounded-lg border border-border p-2 text-sm text-muted transition-colors hover:border-[#ffb183]/40 hover:text-[#ffb183]"
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

export function Tags({ onAbrir }: { onAbrir: (tag: string) => void }) {
  const [tags, setTags] = useState<{ tag: string; total: number }[] | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetch('/api/contacts/tags', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (vivo) setTags(b?.tags ?? []);
      })
      .catch(() => {
        if (vivo) setTags([]);
      });
    return () => {
      vivo = false;
    };
  }, [versao]);

  async function renomear(de: string) {
    setErro(null);
    const r = await fetch('/api/contacts/tags', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ de, para: novoNome }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setErro(b.error ?? 'Não consegui renomear.');
    setEditando(null);
    setVersao((v) => v + 1);
  }

  async function apagar(tag: string, total: number) {
    if (!window.confirm(`Tirar a tag "${tag}" de ${total} contato(s)? Os contatos continuam cadastrados.`)) return;
    setErro(null);
    const r = await fetch(`/api/contacts/tags?tag=${encodeURIComponent(tag)}`, { method: 'DELETE' });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setErro(b.error ?? 'Não consegui apagar.');
    setVersao((v) => v + 1);
  }

  if (!tags) return <p className="text-sm text-muted">Carregando tags…</p>;

  return (
    <div>
      <p className="mb-3 max-w-2xl text-sm leading-relaxed text-muted">
        Renomear para o nome de uma tag que já existe <b className="text-ink">junta as duas</b> — útil para limpar
        &quot;vip&quot;, &quot;VIP &quot; e &quot;cliente-vip&quot; numa só.
      </p>
      {erro && (
        <p role="alert" className="mb-3 text-sm text-[#ffb183]">
          {erro}
        </p>
      )}
      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {tags.length === 0 ? (
          <p className="p-6 text-sm text-muted">Nenhum contato tem tag ainda. Tags chegam pelo CSV, pela ficha do contato ou pelas automações.</p>
        ) : (
          tags.map((t) => (
            <div key={t.tag} className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3 first:border-t-0">
              {editando === t.tag ? (
                <>
                  <input
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    autoFocus
                    aria-label="Nome novo da tag"
                    className={`${inputCls} !py-2 min-w-[180px] flex-1 text-[13px]`}
                  />
                  <button
                    type="button"
                    onClick={() => void renomear(t.tag)}
                    disabled={!novoNome.trim()}
                    className="rounded-lg bg-blue px-3 py-2 text-xs font-semibold text-on-blue disabled:bg-surface2 disabled:text-muted"
                  >
                    Salvar
                  </button>
                  <button type="button" onClick={() => setEditando(null)} className="text-xs font-semibold text-muted hover:text-ink">
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => onAbrir(t.tag)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline">
                    {t.tag}
                  </button>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{formatarNumero(t.total)} contatos</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditando(t.tag);
                      setNovoNome(t.tag);
                    }}
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
                  >
                    Renomear
                  </button>
                  <button
                    type="button"
                    onClick={() => void apagar(t.tag, t.total)}
                    aria-label={`Apagar a tag ${t.tag}`}
                    className="shrink-0 rounded-lg border border-border p-1.5 text-sm text-muted transition-colors hover:border-[#ffb183]/40 hover:text-[#ffb183]"
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
