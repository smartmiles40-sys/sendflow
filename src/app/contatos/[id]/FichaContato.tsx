'use client';

// A ficha do contato — o "Contact record" do ActiveCampaign: quem é, o que tem (tags,
// listas, campos), quanto engaja (pontuação) e tudo o que aconteceu com ele, em ordem.

import Link from 'next/link';
import { useState } from 'react';
import type { Contact } from '@/lib/types';
import { inputCls } from '@/components/ui';
import { separarTags } from '@/lib/contatos';
import { formatarTelefone } from '@/lib/whatsapp/jid';

export interface EventoContato {
  id: number;
  tipo: string;
  detalhe: Record<string, unknown>;
  criado_em: string;
}

interface EmailRecebido {
  campaign_id: string;
  status: string;
  enviado_em: string | null;
  primeiro_aberto_em: string | null;
  primeiro_clique_em: string | null;
  aberturas: number;
  cliques: number;
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const ICONE: Record<string, string> = {
  criado: '✨',
  tag_adicionada: '🏷️',
  tag_removida: '🏷️',
  entrou_lista: '📥',
  saiu_lista: '📤',
  email_aberto: '👀',
  email_clicado: '🖱️',
  descadastrou_email: '🚫',
  bounce: '⚠️',
  spam: '⚠️',
  reinscreveu_email: '✅',
  formulario: '📝',
  nota: '🗒️',
};

export function FichaContato({
  contato: inicial,
  eventos: eventosIniciais,
  listaIds: listaIdsIniciais,
  listas,
  campos,
  emails,
  nomesCampanha,
}: {
  contato: Contact;
  eventos: EventoContato[];
  listaIds: string[];
  listas: { id: string; nome: string; cor: string }[];
  campos: { chave: string; rotulo: string; tipo: string }[];
  emails: EmailRecebido[];
  nomesCampanha: Record<string, string>;
}) {
  const [contato, setContato] = useState(inicial);
  const [eventos, setEventos] = useState(eventosIniciais);
  const [listaIds, setListaIds] = useState(listaIdsIniciais);
  const [novaTag, setNovaTag] = useState('');
  const [valoresCampos, setValoresCampos] = useState<Record<string, string>>(inicial.campos ?? {});
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const nomeLista = (id: unknown) => listas.find((l) => l.id === id)?.nome ?? 'lista apagada';
  const nomeCamp = (id: unknown) => nomesCampanha[String(id)] ?? 'campanha';

  function descrever(e: EventoContato): string {
    const d = e.detalhe;
    switch (e.tipo) {
      case 'criado':
        return `Entrou na base${d.origem ? ` (origem: ${d.origem})` : ''}`;
      case 'tag_adicionada':
        return `Ganhou a tag "${d.tag}"`;
      case 'tag_removida':
        return `Perdeu a tag "${d.tag}"`;
      case 'entrou_lista':
        return `Entrou na lista ${nomeLista(d.list_id)}`;
      case 'saiu_lista':
        return `Saiu da lista ${nomeLista(d.list_id)}`;
      case 'email_aberto':
        return `Abriu o e-mail "${nomeCamp(d.campaign_id)}"`;
      case 'email_clicado':
        return `Clicou em ${String(d.url ?? 'um link')} no e-mail "${nomeCamp(d.campaign_id)}"`;
      case 'descadastrou_email':
        return 'Saiu da lista de e-mail';
      case 'bounce':
        return 'E-mail voltou (bounce) — saiu dos envios';
      case 'spam':
        return 'Marcou um e-mail como spam — saiu dos envios';
      case 'reinscreveu_email':
        return 'Voltou a receber e-mail';
      case 'formulario':
        return `Preencheu o formulário ${String(d.nome ?? '')}`.trim();
      case 'nota':
        return String(d.texto ?? '');
      default:
        return e.tipo;
    }
  }

  async function salvar(patch: Record<string, unknown>, ok: string) {
    setErro(null);
    setAviso(null);
    const r = await fetch(`/api/contacts/${contato.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(b.error ?? 'Não consegui salvar.');
      return false;
    }
    setContato((c) => ({ ...c, ...(b as Contact) }));
    setAviso(ok);
    // A linha do tempo é escrita pelo banco — relê para mostrar o que a mudança gerou.
    const f = await fetch(`/api/contacts/${contato.id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (f?.eventos) setEventos(f.eventos);
    if (f?.contato) setContato(f.contato);
    return true;
  }

  async function adicionarTag() {
    const novas = separarTags(novaTag);
    if (!novas.length) return;
    const tags = [...new Set([...(contato.tags ?? []), ...novas])];
    if (await salvar({ tags }, 'Tag adicionada.')) setNovaTag('');
  }

  async function anotar() {
    setErro(null);
    const r = await fetch(`/api/contacts/${contato.id}/notas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texto: nota }),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setErro(b.error ?? 'Não consegui anotar.');
    setEventos((l) => [b as EventoContato, ...l]);
    setNota('');
  }

  const camposMudaram = campos.some((f) => (valoresCampos[f.chave] ?? '') !== (contato.campos?.[f.chave] ?? ''));

  return (
    <div className="max-w-6xl">
      <Link href="/contatos" className="mb-2 inline-block text-xs font-semibold text-muted hover:text-ink">
        ← Contatos
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">{contato.nome || 'Sem nome'}</h1>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {contato.email && <span>{contato.email}</span>}
            {contato.telefone && <span className="tabular-nums">{formatarTelefone(contato.telefone)}</span>}
            {contato.empresa && <span>{contato.empresa}</span>}
          </p>
        </div>
        <div className="rounded-xl2 border border-border bg-surface px-5 py-3 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Pontuação</div>
          <div className="font-display text-[28px] font-semibold leading-tight tabular-nums">{contato.score ?? 0}</div>
        </div>
      </header>

      {erro && (
        <p role="alert" className="mb-4 text-sm text-[#ffb183]">
          {erro}
        </p>
      )}
      {aviso && <p className="mb-4 text-sm text-[#D7F264]">{aviso}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-4">
          <Cartao titulo="Tags">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(contato.tags ?? []).length === 0 && <span className="text-xs text-muted">Nenhuma tag.</span>}
              {(contato.tags ?? []).map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface2 py-1 pl-2.5 pr-1 text-xs">
                  {t}
                  <button
                    type="button"
                    onClick={() => void salvar({ tags: contato.tags.filter((x) => x !== t) }, 'Tag removida.')}
                    aria-label={`Remover a tag ${t}`}
                    className="rounded-full px-1.5 text-muted hover:text-[#ffb183]"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={novaTag}
                onChange={(e) => setNovaTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void adicionarTag();
                }}
                placeholder="nova tag (vírgula separa várias)"
                aria-label="Nova tag"
                className={`${inputCls} !py-2 flex-1 text-[13px]`}
              />
              <button
                type="button"
                onClick={() => void adicionarTag()}
                disabled={!novaTag.trim()}
                className="rounded-xl border border-border px-3 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:opacity-40"
              >
                ＋
              </button>
            </div>
          </Cartao>

          <Cartao titulo="Listas">
            {listas.length === 0 ? (
              <p className="text-xs text-muted">Nenhuma lista criada ainda.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {listas.map((l) => {
                  const marcada = listaIds.includes(l.id);
                  return (
                    <label key={l.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={async () => {
                          const novas = marcada ? listaIds.filter((x) => x !== l.id) : [...listaIds, l.id];
                          if (await salvar({ list_ids: novas }, marcada ? `Saiu de ${l.nome}.` : `Entrou em ${l.nome}.`)) setListaIds(novas);
                        }}
                        className="h-4 w-4 accent-[#D7F264]"
                      />
                      <span className="h-2 w-2 rounded-full" style={{ background: l.cor }} />
                      {l.nome}
                    </label>
                  );
                })}
              </div>
            )}
          </Cartao>

          <Cartao titulo="Campos personalizados">
            {campos.length === 0 ? (
              <p className="text-xs text-muted">Nenhum campo criado. Eles aparecem em Automações → Campos.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {campos.map((f) => (
                  <label key={f.chave} className="text-sm">
                    <span className="mb-1 block text-xs font-semibold text-muted">{f.rotulo}</span>
                    <input
                      value={valoresCampos[f.chave] ?? ''}
                      onChange={(e) => setValoresCampos((v) => ({ ...v, [f.chave]: e.target.value }))}
                      type={f.tipo === 'data' ? 'date' : f.tipo === 'numero' ? 'number' : 'text'}
                      className={`${inputCls} !py-2 text-[13px]`}
                    />
                  </label>
                ))}
                {camposMudaram && (
                  <button
                    type="button"
                    onClick={() => void salvar({ campos: { ...(contato.campos ?? {}), ...valoresCampos } }, 'Campos salvos.')}
                    className="self-start rounded-xl bg-blue px-4 py-2 text-[13px] font-semibold text-on-blue hover:bg-blue-hover"
                  >
                    Salvar campos
                  </button>
                )}
              </div>
            )}
          </Cartao>

          <Cartao titulo="Permissões">
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>E-mail: <b>{contato.status_email}</b></span>
                {contato.status_email === 'ativo' && contato.email && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Descadastrar este contato do e-mail? Ele deixa de receber campanhas e automações de e-mail.')) {
                        void salvar({ status_email: 'descadastrado' }, 'Descadastrado do e-mail.');
                      }
                    }}
                    className="text-xs font-semibold text-muted underline underline-offset-2 hover:text-[#ffb183]"
                  >
                    Descadastrar
                  </button>
                )}
              </div>
              {contato.telefone && (
                <span>
                  WhatsApp: <b>{contato.status_whatsapp}</b>
                </span>
              )}
            </div>
          </Cartao>
        </div>

        <div className="flex flex-col gap-4">
          <Cartao titulo="Linha do tempo">
            <div className="mb-4 flex gap-2">
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nota.trim()) void anotar();
                }}
                placeholder="Anotar algo sobre este contato…"
                aria-label="Nova anotação"
                className={`${inputCls} !py-2 flex-1 text-[13px]`}
              />
              <button
                type="button"
                onClick={() => void anotar()}
                disabled={!nota.trim()}
                className="rounded-xl bg-blue px-3.5 text-[13px] font-semibold text-on-blue disabled:bg-surface2 disabled:text-muted"
              >
                Anotar
              </button>
            </div>
            {eventos.length === 0 ? (
              <p className="text-xs text-muted">Nada aconteceu ainda.</p>
            ) : (
              <ol className="flex flex-col">
                {eventos.map((e) => (
                  <li key={e.id} className="flex gap-3 border-t border-border py-2.5 first:border-t-0">
                    <span aria-hidden="true" className="w-5 shrink-0 text-center">
                      {ICONE[e.tipo] ?? '•'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`break-words text-sm ${e.tipo === 'nota' ? 'rounded-lg bg-surface2/60 px-2.5 py-1.5' : ''}`}>{descrever(e)}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{quando(e.criado_em)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Cartao>

          <Cartao titulo="E-mails recebidos">
            {emails.length === 0 ? (
              <p className="text-xs text-muted">Nenhuma campanha de e-mail enviada para este contato.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1.5 pr-3 font-semibold">Campanha</th>
                      <th className="py-1.5 pr-3 font-semibold">Enviado</th>
                      <th className="py-1.5 pr-3 font-semibold">Abriu</th>
                      <th className="py-1.5 font-semibold">Clicou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emails.map((r) => (
                      <tr key={r.campaign_id} className="border-t border-border">
                        <td className="py-2 pr-3">{nomesCampanha[r.campaign_id] ?? '—'}</td>
                        <td className="py-2 pr-3 text-muted">{quando(r.enviado_em)}</td>
                        <td className="py-2 pr-3">{r.primeiro_aberto_em ? `✓ ${r.aberturas}x` : '—'}</td>
                        <td className="py-2">{r.primeiro_clique_em ? `✓ ${r.cliques}x` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Cartao>
        </div>
      </div>
    </div>
  );
}

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl2 border border-border bg-surface p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{titulo}</h2>
      {children}
    </section>
  );
}
