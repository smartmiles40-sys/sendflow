'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GroupTag } from '@/lib/types';
import type { InfoGrupo, Participante } from '@/lib/whatsapp/grupo';
import { formatarTelefone } from '@/lib/whatsapp/jid';
import { uploadMedia } from '@/lib/upload-client';
import { TagChip } from '@/components/TagChip';
import { WA } from './wa';

type Resposta = { ok?: boolean; error?: string; link?: string | null; feitos?: number; recusados?: { jid: string; motivo: string }[] };

/**
 * "Dados do grupo" do WhatsApp, dentro do SendFlow: nome, descrição, foto, as regras de
 * quem manda mensagem e quem edita, mensagens temporárias, link de convite e a lista de
 * participantes com adicionar / remover / tornar admin.
 */
export function PainelDoGrupo({
  conexaoId,
  jid,
  grupoId,
  tags,
  tagIds,
  onTagsChange,
  onFechar,
  onMudouNome,
}: {
  conexaoId: string;
  jid: string;
  /** Id do grupo no SendFlow; nulo quando o grupo não está cadastrado. */
  grupoId: string | null;
  tags: GroupTag[];
  tagIds: string[];
  onTagsChange: (ids: string[]) => void;
  onFechar: () => void;
  onMudouNome: (nome: string) => void;
}) {
  const [info, setInfo] = useState<InfoGrupo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const [descricao, setDescricao] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [adicionando, setAdicionando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/celular/grupo?conexao=${encodeURIComponent(conexaoId)}&jid=${encodeURIComponent(jid)}`, {
      cache: 'no-store',
    }).catch(() => null);
    const b = await r?.json().catch(() => ({}));
    if (!r?.ok) {
      setErro(b?.error ?? 'Não foi possível ler os dados do grupo.');
      return;
    }
    setErro(null);
    setInfo(b as InfoGrupo);
  }, [conexaoId, jid]);

  useEffect(() => {
    const t = setTimeout(() => void carregar(), 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const admin = info?.meuPapel === 'admin' || info?.meuPapel === 'dono';
  // Papel desconhecido (LID): deixa tentar; o WhatsApp recusa se não puder.
  const podeMexer = admin || info?.meuPapel === null;
  const podeEditarDados = podeMexer || (info ? !info.soAdminsEditam : false);

  async function acao(acao: string, extra: Record<string, unknown> = {}, sucesso?: string): Promise<Resposta | null> {
    setOcupado(acao);
    setAviso(null);
    const r = await fetch('/api/celular/grupo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conexao: conexaoId || null, jid, acao, ...extra }),
    }).catch(() => null);
    const b = ((await r?.json().catch(() => ({}))) ?? {}) as Resposta;
    setOcupado(null);
    if (!r?.ok) {
      setAviso(`⚠ ${b.error ?? 'Não foi possível fazer a alteração.'}`);
      return null;
    }
    if (sucesso) setAviso(sucesso);
    return b;
  }

  async function salvarNome() {
    if (nome === null || !nome.trim()) return;
    if (await acao('nome', { valor: nome.trim() }, 'Nome do grupo alterado.')) {
      onMudouNome(nome.trim());
      setNome(null);
      void carregar();
    }
  }

  async function salvarDescricao() {
    if (descricao === null) return;
    if (await acao('descricao', { valor: descricao }, 'Descrição alterada.')) {
      setDescricao(null);
      void carregar();
    }
  }

  async function trocarFoto(arquivo: File) {
    if (!arquivo.type.startsWith('image/')) {
      setAviso('⚠ Escolha uma imagem (JPG ou PNG).');
      return;
    }
    setOcupado('foto');
    const up = await uploadMedia(arquivo);
    if ('error' in up) {
      setOcupado(null);
      setAviso(`⚠ ${up.error}`);
      return;
    }
    if (await acao('foto', { valor: up.url }, 'Foto do grupo trocada.')) void carregar();
  }

  async function regra(chave: 'so_admins_enviam' | 'so_admins_editam', valor: boolean) {
    if (await acao(chave, { valor }, 'Configuração salva.')) void carregar();
  }

  async function participantes(operacao: 'add' | 'remove' | 'promote' | 'demote', pessoas: string[], rotulo: string) {
    const b = await acao('participantes', { operacao, pessoas });
    if (!b) return;
    const recusados = b.recusados ?? [];
    setAviso(
      recusados.length
        ? `${rotulo}: ${b.feitos ?? 0} ok. Não deu para ${recusados.length}: ${recusados
            .slice(0, 4)
            .map((r) => `${formatarTelefone(r.jid.split('@')[0]) || r.jid} (${r.motivo})`)
            .join('; ')}`
        : `${rotulo}: feito.`,
    );
    void carregar();
  }

  async function adicionar() {
    const numeros = (adicionando ?? '')
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!numeros.length) return;
    await participantes('add', numeros, 'Adicionar');
    setAdicionando(null);
  }

  function toggleTag(id: string) {
    if (!grupoId) return;
    const novas = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id];
    onTagsChange(novas);
    void fetch(`/api/groups/${grupoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_ids: novas }),
    }).then((r) => {
      if (!r.ok) {
        setAviso('⚠ Não foi possível salvar a tag.');
        onTagsChange(tagIds);
      }
    });
  }

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const todos = info?.participantes ?? [];
    if (!q) return todos;
    const digitos = q.replace(/\D/g, '');
    return todos.filter(
      (p) => (p.nome ?? '').toLowerCase().includes(q) || (Boolean(digitos) && (p.telefone ?? '').includes(digitos)),
    );
  }, [info, busca]);

  const secao = 'border-b px-4 py-4';
  const botao = 'rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-wait';

  return (
    <aside
      className="absolute inset-0 z-20 flex flex-col md:static md:w-[380px] md:shrink-0 md:border-l"
      style={{ background: WA.lista, borderColor: WA.linha }}
      aria-label="Dados do grupo"
    >
      <header className="flex items-center gap-3 px-3 py-3" style={{ background: WA.barra }}>
        <button type="button" onClick={onFechar} className="rounded-full px-2 py-1 text-lg leading-none" aria-label="Fechar dados do grupo">
          ✕
        </button>
        <span className="text-[15px] font-semibold">Dados do grupo</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {erro && (
          <div className="m-3 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: WA.erroFundo, color: WA.erroTexto }}>
            {erro}
          </div>
        )}
        {!info && !erro && (
          <p className="px-4 py-8 text-center text-sm" style={{ color: WA.cinza }}>
            Lendo o grupo no WhatsApp…
          </p>
        )}

        {info && (
          <>
            {/* Foto, nome, descrição */}
            <div className={`${secao} text-center`} style={{ borderColor: WA.linha }}>
              <label className={`mx-auto block w-fit ${podeEditarDados ? 'cursor-pointer' : ''}`} title={podeEditarDados ? 'Trocar a foto do grupo' : undefined}>
                {info.foto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.foto} alt="" className="h-24 w-24 rounded-full object-cover" />
                ) : (
                  <span className="flex h-24 w-24 items-center justify-center rounded-full text-4xl" style={{ background: '#6a7175' }}>
                    👥
                  </span>
                )}
                {podeEditarDados && (
                  <>
                    <span className="mt-1 block text-[12px]" style={{ color: WA.verde }}>
                      {ocupado === 'foto' ? 'Enviando…' : 'Trocar foto'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void trocarFoto(f);
                      }}
                    />
                  </>
                )}
              </label>

              {nome === null ? (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <h2 className="text-[18px] font-semibold">{info.nome}</h2>
                  {podeEditarDados && (
                    <button type="button" onClick={() => setNome(info.nome)} aria-label="Editar nome do grupo" style={{ color: WA.cinza }}>
                      ✏️
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    maxLength={100}
                    aria-label="Nome do grupo"
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[14px] outline-none"
                    style={{ background: WA.barra, color: WA.texto }}
                    autoFocus
                  />
                  <button type="button" onClick={() => void salvarNome()} disabled={ocupado === 'nome'} className={botao} style={{ background: WA.verde, color: WA.fundo }}>
                    Salvar
                  </button>
                  <button type="button" onClick={() => setNome(null)} style={{ color: WA.cinza }} className="text-[12.5px]">
                    Cancelar
                  </button>
                </div>
              )}
              <p className="mt-1 text-[13px]" style={{ color: WA.cinza }}>
                Grupo · {info.total} participantes
              </p>

              <div className="mt-3 text-left">
                {descricao === null ? (
                  <button
                    type="button"
                    disabled={!podeEditarDados}
                    onClick={() => setDescricao(info.descricao)}
                    className="w-full rounded-md px-2 py-2 text-left text-[13.5px] disabled:cursor-default"
                    style={{ background: 'rgba(255,255,255,.03)' }}
                  >
                    <span className="mb-0.5 block text-[12px]" style={{ color: WA.verde }}>
                      Descrição {podeEditarDados && '· tocar para editar'}
                    </span>
                    <span className="whitespace-pre-wrap break-words" style={{ color: info.descricao ? WA.texto : WA.cinza }}>
                      {info.descricao || 'Sem descrição'}
                    </span>
                  </button>
                ) : (
                  <div>
                    <textarea
                      value={descricao}
                      onChange={(e) => setDescricao(e.target.value)}
                      maxLength={2048}
                      rows={5}
                      aria-label="Descrição do grupo"
                      className="w-full rounded-md p-2 text-[13.5px] outline-none"
                      style={{ background: WA.barra, color: WA.texto }}
                      autoFocus
                    />
                    <div className="mt-1 flex justify-end gap-2">
                      <button type="button" onClick={() => setDescricao(null)} style={{ color: WA.cinza }} className="text-[12.5px]">
                        Cancelar
                      </button>
                      <button type="button" onClick={() => void salvarDescricao()} disabled={ocupado === 'descricao'} className={botao} style={{ background: WA.verde, color: WA.fundo }}>
                        Salvar descrição
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!admin && (
              <div className="mx-4 mt-4 rounded-lg px-3 py-2.5 text-[12.5px]" style={{ background: '#2a2a1b', color: '#f3e3a4' }}>
                {info.meuPapel === null
                  ? 'Não deu para confirmar se este número é admin do grupo. Pode tentar; se não for, o WhatsApp recusa.'
                  : 'Este número NÃO é admin do grupo: só dá para ver. Peça para um admin promovê-lo.'}
              </div>
            )}

            {/* Tags do SendFlow */}
            <div className={secao} style={{ borderColor: WA.linha }}>
              <h3 className="mb-2 text-[13px] font-semibold" style={{ color: WA.verde }}>
                Tags no SendFlow
              </h3>
              {!grupoId ? (
                <p className="text-[12.5px]" style={{ color: WA.cinza }}>
                  Este grupo não está cadastrado no SendFlow. Puxe os grupos em Conexões para poder etiquetar.
                </p>
              ) : tags.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: WA.cinza }}>
                  Nenhuma tag criada ainda — crie na tela Grupos.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <TagChip key={t.id} tag={t} pequeno ativo={tagIds.includes(t.id)} onClick={() => toggleTag(t.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* Configurações */}
            <div className={secao} style={{ borderColor: WA.linha }}>
              <h3 className="mb-3 text-[13px] font-semibold" style={{ color: WA.verde }}>
                Configurações do grupo
              </h3>
              <Opcao
                titulo="Quem pode enviar mensagens"
                valor={info.soAdminsEnviam}
                rotulos={['Todos', 'Só admins']}
                desabilitado={!podeMexer || ocupado === 'so_admins_enviam'}
                onChange={(v) => void regra('so_admins_enviam', v)}
              />
              <Opcao
                titulo="Quem pode editar nome, foto e descrição"
                valor={info.soAdminsEditam}
                rotulos={['Todos', 'Só admins']}
                desabilitado={!podeMexer || ocupado === 'so_admins_editam'}
                onChange={(v) => void regra('so_admins_editam', v)}
              />
              <div className="mt-3">
                <div className="mb-1.5 text-[13px]">Mensagens temporárias</div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      [0, 'Desligado'],
                      [86_400, '24 horas'],
                      [604_800, '7 dias'],
                      [7_776_000, '90 dias'],
                    ] as const
                  ).map(([s, r]) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!podeMexer || ocupado === 'temporarias'}
                      onClick={() => void acao('temporarias', { valor: s }, `Mensagens temporárias: ${r.toLowerCase()}.`)}
                      className="rounded-full px-3 py-1 text-[12.5px] disabled:cursor-not-allowed"
                      style={{ background: WA.barra, color: podeMexer ? WA.texto : WA.cinza }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11.5px]" style={{ color: WA.cinza }}>
                  O WhatsApp não informa qual está valendo agora — escolher uma aplica na hora.
                </p>
              </div>
            </div>

            {/* Link de convite */}
            <div className={secao} style={{ borderColor: WA.linha }}>
              <h3 className="mb-2 text-[13px] font-semibold" style={{ color: WA.verde }}>
                Link de convite
              </h3>
              {link ? (
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[12.5px]" style={{ background: WA.barra }}>
                    {link}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(link);
                      setAviso('Link copiado.');
                    }}
                    className={botao}
                    style={{ background: WA.barra, color: WA.texto }}
                  >
                    Copiar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!podeMexer || ocupado === 'link'}
                  onClick={async () => {
                    const b = await acao('link');
                    if (b?.link) setLink(b.link);
                  }}
                  className={botao}
                  style={{ background: WA.barra, color: WA.texto }}
                >
                  {ocupado === 'link' ? 'Buscando…' : 'Mostrar o link'}
                </button>
              )}
              {podeMexer && (
                <button
                  type="button"
                  disabled={ocupado === 'redefinir_link'}
                  onClick={async () => {
                    if (!window.confirm('Redefinir o link? O link atual para de funcionar para todo mundo que já tem.')) return;
                    const b = await acao('redefinir_link', {}, 'Link redefinido. O antigo não funciona mais.');
                    if (b?.link) setLink(b.link);
                  }}
                  className="mt-2 block text-[12.5px]"
                  style={{ color: WA.erroTexto }}
                >
                  Redefinir link
                </button>
              )}
            </div>

            {/* Participantes */}
            <div className={secao} style={{ borderColor: WA.linha }}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="flex-1 text-[13px] font-semibold" style={{ color: WA.verde }}>
                  {info.total} participantes
                </h3>
                {podeMexer && adicionando === null && (
                  <button type="button" onClick={() => setAdicionando('')} className={botao} style={{ background: WA.verde, color: WA.fundo }}>
                    ＋ Adicionar
                  </button>
                )}
              </div>

              {adicionando !== null && (
                <div className="mb-3 rounded-lg p-2.5" style={{ background: WA.barra }}>
                  <label className="mb-1 block text-[12.5px]" htmlFor="numeros-add">
                    Telefones (um por linha, com DDD):
                  </label>
                  <textarea
                    id="numeros-add"
                    value={adicionando}
                    onChange={(e) => setAdicionando(e.target.value)}
                    rows={4}
                    placeholder={'11 99999-9999\n21 98888-7777'}
                    className="w-full rounded-md p-2 text-[13px] outline-none"
                    style={{ background: WA.lista, color: WA.texto }}
                    autoFocus
                  />
                  <p className="mt-1 text-[11.5px]" style={{ color: WA.cinza }}>
                    Quem tem a privacidade “só meus contatos me adicionam” não entra direto — para essas pessoas, mande o link.
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setAdicionando(null)} className="text-[12.5px]" style={{ color: WA.cinza }}>
                      Cancelar
                    </button>
                    <button type="button" onClick={() => void adicionar()} disabled={ocupado === 'participantes'} className={botao} style={{ background: WA.verde, color: WA.fundo }}>
                      {ocupado === 'participantes' ? 'Adicionando…' : 'Adicionar ao grupo'}
                    </button>
                  </div>
                </div>
              )}

              {info.participantes.length > 8 && (
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Pesquisar participante"
                  aria-label="Pesquisar participante"
                  className="mb-2 w-full rounded-lg px-3 py-2 text-[13px] outline-none placeholder:text-[#8696a0]"
                  style={{ background: WA.barra, color: WA.texto }}
                />
              )}

              <ul>
                {lista.map((p) => (
                  <LinhaParticipante
                    key={p.jid}
                    p={p}
                    podeMexer={podeMexer}
                    ocupado={ocupado === 'participantes'}
                    onAcao={(op, rotulo) => {
                      const quem = p.nome || formatarTelefone(p.telefone ?? '') || 'esta pessoa';
                      if (op === 'remove' && !window.confirm(`Remover ${quem} do grupo?`)) return;
                      void participantes(op, [p.jid], rotulo);
                    }}
                  />
                ))}
              </ul>
            </div>

            <div className="px-4 py-4">
              <button
                type="button"
                disabled={ocupado === 'sair'}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `O número vai SAIR do grupo “${info.nome}”. Depois disso só alguém de dentro consegue adicioná-lo de volta, e o SendFlow desativa o grupo para disparo. Continuar?`,
                    )
                  )
                    return;
                  if (await acao('sair', {}, 'O número saiu do grupo.')) void carregar();
                }}
                className="text-[13.5px] font-semibold"
                style={{ color: '#f15c6d' }}
              >
                ⎋ Sair do grupo
              </button>
            </div>
          </>
        )}
      </div>

      {aviso && (
        <div className="flex items-start gap-3 px-4 py-2.5 text-[13px]" style={{ background: WA.barra }} role="status">
          <span className="min-w-0 flex-1">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso" style={{ color: WA.cinza }}>
            ×
          </button>
        </div>
      )}
    </aside>
  );
}

function Opcao({
  titulo,
  valor,
  rotulos,
  desabilitado,
  onChange,
}: {
  titulo: string;
  valor: boolean;
  rotulos: [string, string];
  desabilitado: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[13px]">{titulo}</div>
      <div className="inline-flex rounded-full p-0.5" style={{ background: WA.barra }}>
        {[false, true].map((v, i) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={valor === v}
            disabled={desabilitado || valor === v}
            onClick={() => onChange(v)}
            className="rounded-full px-3 py-1 text-[12.5px] font-medium disabled:cursor-default"
            style={valor === v ? { background: WA.verde, color: WA.fundo } : { color: desabilitado ? '#5f6d74' : WA.cinza }}
          >
            {rotulos[i]}
          </button>
        ))}
      </div>
    </div>
  );
}

function LinhaParticipante({
  p,
  podeMexer,
  ocupado,
  onAcao,
}: {
  p: Participante;
  podeMexer: boolean;
  ocupado: boolean;
  onAcao: (op: 'remove' | 'promote' | 'demote', rotulo: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const titulo = p.nome ?? (p.telefone ? formatarTelefone(p.telefone) : 'Participante');
  return (
    <li className="flex items-center gap-3 py-2">
      {p.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.foto} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: '#6a7175' }} aria-hidden="true">
          {(titulo.replace(/[^\p{L}]/gu, '')[0] ?? '?').toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]">{titulo}</div>
        <div className="truncate text-[12px]" style={{ color: WA.cinza }}>
          {p.nome && p.telefone ? formatarTelefone(p.telefone) : !p.telefone ? 'número oculto pelo WhatsApp' : ''}
        </div>
      </div>
      {p.papel && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px]" style={{ background: '#0a332c', color: '#d9fdd3' }}>
          {p.papel === 'dono' ? 'dono' : 'admin'}
        </span>
      )}
      {podeMexer && p.papel !== 'dono' && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-label={`Opções para ${titulo}`}
            aria-expanded={menu}
            disabled={ocupado}
            className="rounded-full px-2 py-1 text-lg leading-none hover:bg-white/10"
            style={{ color: WA.cinza }}
          >
            ⋮
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-30 w-48 overflow-hidden rounded-lg py-1 shadow-xl" style={{ background: '#233138' }}>
              {p.papel === 'admin' ? (
                <ItemMenu onClick={() => (setMenu(false), onAcao('demote', 'Tirar de admin'))}>Tirar de admin</ItemMenu>
              ) : (
                <ItemMenu onClick={() => (setMenu(false), onAcao('promote', 'Tornar admin'))}>Tornar admin do grupo</ItemMenu>
              )}
              <ItemMenu perigo onClick={() => (setMenu(false), onAcao('remove', 'Remover'))}>
                Remover do grupo
              </ItemMenu>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ItemMenu({ children, onClick, perigo }: { children: React.ReactNode; onClick: () => void; perigo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-4 py-2.5 text-left text-[13.5px] hover:bg-white/5"
      style={{ color: perigo ? '#f15c6d' : WA.texto }}
    >
      {children}
    </button>
  );
}
