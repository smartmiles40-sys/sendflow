'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Contact, Lista } from '@/lib/types';
import { inputCls } from '@/components/ui';
import { formatarNumero } from '@/lib/kpis';
import { formatarTelefone } from '@/lib/whatsapp/jid';
import { REGRAS_VAZIAS, validarRegras, type Regras } from '@/lib/segmentos';
import { RegrasSegmento, type OpcoesSegmento } from '@/components/RegrasSegmento';
import { ImportarContatos } from './ImportarContatos';
import { Segmentos, Tags, type Segmento } from './SegmentosETags';

type Aba = 'contatos' | 'segmentos' | 'tags' | 'listas';

export function ContatosClient({
  inicial,
  total,
  listas: listasIniciais,
  resumo,
  opcoes,
}: {
  inicial: Contact[];
  total: number;
  listas: Lista[];
  resumo: { comEmail: number; comWhatsApp: number; descadastrados: number };
  opcoes: Omit<OpcoesSegmento, 'listas'>;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('contatos');
  const [listas, setListas] = useState(listasIniciais);
  const [importando, setImportando] = useState(false);
  // Segmento aberto a partir da aba Segmentos (ou uma tag da aba Tags): a tabela de
  // contatos já abre filtrada por ele.
  const [segmentoAberto, setSegmentoAberto] = useState<Segmento | null>(null);
  const todasOpcoes: OpcoesSegmento = { ...opcoes, listas };

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">
            Contatos e listas
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Uma base só para os dois canais. A mesma pessoa tem e-mail e telefone aqui, e cada canal
            guarda a própria permissão — quem descadastra do e-mail continua recebendo WhatsApp, e
            vice-versa.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportando(true)}
          className="shrink-0 rounded-xl bg-blue px-[18px] py-3 text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover"
        >
          ↑ Importar CSV
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Cartao label="Contatos" valor={formatarNumero(total)} />
        <Cartao label="Alcançáveis por e-mail" valor={formatarNumero(resumo.comEmail)} />
        <Cartao label="Alcançáveis por WhatsApp" valor={formatarNumero(resumo.comWhatsApp)} />
        <Cartao
          label="Fora da lista de e-mail"
          valor={formatarNumero(resumo.descadastrados)}
          apoio="descadastro, bounce ou spam"
        />
      </div>

      <div className="mb-3.5 flex gap-1.5 border-b border-border">
        {(
          [
            { key: 'contatos', label: 'Contatos' },
            { key: 'segmentos', label: 'Segmentos' },
            { key: 'tags', label: 'Tags' },
            { key: 'listas', label: `Listas (${listas.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setAba(t.key)}
            aria-pressed={aba === t.key}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              aba === t.key ? 'border-blue text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'contatos' && (
        <TabelaContatos
          key={segmentoAberto?.id ?? 'todos'}
          inicial={inicial}
          total={total}
          listas={listas}
          opcoes={todasOpcoes}
          segmento={segmentoAberto}
          onFecharSegmento={() => setSegmentoAberto(null)}
          onSalvouSegmento={() => setAba('segmentos')}
        />
      )}
      {aba === 'segmentos' && (
        <Segmentos
          opcoes={todasOpcoes}
          onAbrir={(s) => {
            setSegmentoAberto(s);
            setAba('contatos');
          }}
        />
      )}
      {aba === 'tags' && (
        <Tags
          onAbrir={(tag) => {
            setSegmentoAberto({
              id: 'tag:' + tag,
              nome: 'Tag: ' + tag,
              descricao: null,
              regras: { combinar: 'todas', condicoes: [{ campo: 'tag', op: 'tem', valor: tag }] },
              total: 0,
            });
            setAba('contatos');
          }}
        />
      )}
      {aba === 'listas' && <Listas listas={listas} onMudou={setListas} />}

      {importando && (
        <ImportarContatos
          listas={listas}
          onFechar={() => setImportando(false)}
          onConcluido={() => {
            setImportando(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TabelaContatos({
  inicial,
  total,
  listas,
  opcoes,
  segmento,
  onFecharSegmento,
  onSalvouSegmento,
}: {
  inicial: Contact[];
  total: number;
  listas: Lista[];
  opcoes: OpcoesSegmento;
  segmento: Segmento | null;
  onFecharSegmento: () => void;
  onSalvouSegmento: () => void;
}) {
  const [contatos, setContatos] = useState(inicial);
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState('');
  const [pagina, setPagina] = useState(0);
  const [totalFiltrado, setTotalFiltrado] = useState(total);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Filtro avançado = um segmento ainda não salvo. Abre já preenchido quando veio de um segmento.
  const [avancado, setAvancado] = useState(Boolean(segmento));
  const [regras, setRegras] = useState<Regras>(segmento?.regras ?? REGRAS_VAZIAS);
  const [nomeSegmento, setNomeSegmento] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Só regras completas vão para o servidor: uma condição pela metade (tag sem nome)
  // ainda não filtra nada — a tela mantém a última consulta válida.
  const validacao = validarRegras(regras);
  const regrasAtivas =
    avancado && validacao.ok && validacao.regras.condicoes.length ? JSON.stringify(validacao.regras) : '';

  // Busca com atraso de 300 ms: sem isso, cada tecla vira uma consulta, e num campo
  // de busca isso é uma consulta por letra digitada.
  useEffect(() => {
    const timer = setTimeout(async () => {
      setCarregando(true);
      try {
        const params = new URLSearchParams({ pagina: String(pagina) });
        if (busca.trim()) params.set('busca', busca.trim());
        if (lista) params.set('lista', lista);
        if (regrasAtivas) params.set('regras', regrasAtivas);
        const res = await fetch(`/api/contacts?${params}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          setContatos(body.contatos);
          setTotalFiltrado(body.total);
          setErro(null);
        } else {
          setErro(body.error ?? 'Não consegui filtrar.');
        }
      } finally {
        setCarregando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [busca, lista, pagina, regrasAtivas]);

  const segmentoSalvo = Boolean(segmento && !segmento.id.startsWith('tag:'));

  async function salvarSegmento() {
    if (!validacao.ok) return setErro(validacao.erro);
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(segmentoSalvo && segmento ? `/api/segments/${segmento.id}` : '/api/segments', {
        method: segmentoSalvo ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          segmentoSalvo ? { regras: validacao.regras } : { nome: nomeSegmento, regras: validacao.regras },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(body.error ?? 'Não consegui salvar o segmento.');
      setNomeSegmento('');
      onSalvouSegmento();
    } finally {
      setSalvando(false);
    }
  }

  const porPagina = 100;
  const paginas = Math.ceil(totalFiltrado / porPagina);

  return (
    <div>
      {segmento && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-blue/30 bg-blue/[0.06] px-4 py-2.5 text-sm">
          <span>
            {segmentoSalvo ? 'Segmento' : 'Filtro'}: <b>{segmento.nome}</b>
          </span>
          <button
            type="button"
            onClick={onFecharSegmento}
            className="ml-auto text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink"
          >
            Ver todos os contatos
          </button>
        </div>
      )}

      <div className="mb-3.5 flex flex-wrap gap-2.5">
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(0);
          }}
          placeholder="Buscar por nome, e-mail, telefone ou empresa…"
          className={`${inputCls} min-w-[240px] flex-1`}
        />
        <select
          value={lista}
          onChange={(e) => {
            setLista(e.target.value);
            setPagina(0);
          }}
          className={`${inputCls} max-w-[220px]`}
        >
          <option value="">Todas as listas</option>
          {listas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAvancado((v) => !v)}
          aria-expanded={avancado}
          className={`rounded-xl border px-4 py-3 text-[13px] font-semibold transition-colors ${
            avancado ? 'border-blue/50 bg-blue/10 text-ink' : 'border-border text-muted hover:border-blue2 hover:text-ink'
          }`}
        >
          ⚙ Filtro avançado
        </button>
      </div>

      {avancado && (
        <div className="mb-3.5 rounded-xl2 border border-border bg-surface p-4">
          <RegrasSegmento
            regras={regras}
            onChange={(r) => {
              setRegras(r);
              setPagina(0);
            }}
            opcoes={opcoes}
          />
          {!validacao.ok && regras.condicoes.length > 0 && <p className="mt-2 text-xs text-muted">{validacao.erro}</p>}
          {validacao.ok && validacao.regras.condicoes.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {segmentoSalvo && segmento ? (
                <button
                  type="button"
                  onClick={() => void salvarSegmento()}
                  disabled={salvando}
                  className="rounded-xl bg-blue px-4 py-2.5 text-[13px] font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted"
                >
                  {salvando ? 'Salvando…' : `Atualizar "${segmento.nome}"`}
                </button>
              ) : (
                <>
                  <input
                    value={nomeSegmento}
                    onChange={(e) => setNomeSegmento(e.target.value)}
                    placeholder="Nome do segmento — ex.: Engajados da live do Japão"
                    aria-label="Nome do segmento"
                    className={`${inputCls} !py-2.5 min-w-[240px] flex-1 text-[13px]`}
                  />
                  <button
                    type="button"
                    onClick={() => void salvarSegmento()}
                    disabled={salvando || !nomeSegmento.trim()}
                    className="rounded-xl bg-blue px-4 py-2.5 text-[13px] font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted"
                  >
                    {salvando ? 'Salvando…' : 'Salvar como segmento'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {erro && (
        <p role="alert" className="mb-3 text-sm text-[#ffb183]">
          {erro}
        </p>
      )}

      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {contatos.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            {busca || lista || regrasAtivas
              ? 'Nenhum contato com esse filtro.'
              : 'Nenhum contato ainda. Use o botão Importar CSV para trazer sua base.'}
          </p>
        ) : (
          <>
            <div className="hidden grid-cols-[2fr_2fr_1.4fr_0.6fr_1fr] gap-3 bg-surface2 px-[18px] py-[11px] text-xs font-semibold uppercase tracking-[0.06em] text-muted md:grid">
              <div>Nome</div>
              <div>E-mail</div>
              <div>WhatsApp</div>
              <div>Pontos</div>
              <div>Situação</div>
            </div>
            {contatos.map((c) => (
              <Link
                key={c.id}
                href={`/contatos/${c.id}`}
                className="grid grid-cols-1 items-center gap-1 border-t border-border px-[18px] py-3 text-sm transition-colors hover:bg-white/[0.03] md:grid-cols-[2fr_2fr_1.4fr_0.6fr_1fr] md:gap-3"
              >
                <div className="min-w-0">
                  <div className="truncate">{c.nome || <span className="text-muted">sem nome</span>}</div>
                  {c.tags?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded-full bg-surface2 px-2 py-0.5 text-[10px] text-muted">
                          {t}
                        </span>
                      ))}
                      {c.tags.length > 3 && <span className="text-[10px] text-muted">+{c.tags.length - 3}</span>}
                    </div>
                  )}
                </div>
                <div className="truncate text-muted">{c.email ?? '—'}</div>
                <div className="truncate tabular-nums text-muted">
                  {c.telefone ? formatarTelefone(c.telefone) : '—'}
                </div>
                <div className="tabular-nums text-muted">
                  <span className="md:hidden">Pontos: </span>
                  {c.score ?? 0}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Selo status={c.status_email} canal="e-mail" />
                  {c.telefone && <Selo status={c.status_whatsapp} canal="WhatsApp" />}
                </div>
              </Link>
            ))}
          </>
        )}
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{carregando ? 'Buscando…' : `${formatarNumero(totalFiltrado)} contato(s)`}</span>
        {paginas > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:border-blue2 hover:text-ink disabled:opacity-40"
            >
              ← Anterior
            </button>
            <span className="tabular-nums">
              {pagina + 1} de {paginas}
            </span>
            <button
              type="button"
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={pagina >= paginas - 1}
              className="rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:border-blue2 hover:text-ink disabled:opacity-40"
            >
              Próxima →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Selo({ status, canal }: { status: string; canal: string }) {
  if (status === 'ativo') {
    return (
      <span className="rounded-full bg-green/10 px-2 py-0.5 text-[10px] font-semibold text-[#D7F264]">
        {canal} ok
      </span>
    );
  }
  const rotulos: Record<string, string> = {
    descadastrado: 'saiu',
    bounce: 'bounce',
    spam: 'spam',
    invalido: 'inválido',
  };
  return (
    <span
      className="rounded-full bg-orange/15 px-2 py-0.5 text-[10px] font-semibold text-[#ffb183]"
      title={`${canal}: ${rotulos[status] ?? status}`}
    >
      {canal} {rotulos[status] ?? status}
    </span>
  );
}

function Listas({ listas, onMudou }: { listas: Lista[]; onMudou: (l: Lista[]) => void }) {
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body.error ?? body.errors?.[0]?.message ?? 'Não foi possível criar a lista.');
        return;
      }
      onMudou([...listas, body].sort((a, b) => a.nome.localeCompare(b.nome)));
      setNome('');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(l: Lista) {
    if (!window.confirm(`Excluir a lista "${l.nome}"? Os contatos continuam cadastrados — só o agrupamento some.`)) return;
    const res = await fetch(`/api/lists/${l.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(body.error ?? 'Não foi possível excluir.');
      return;
    }
    onMudou(listas.filter((x) => x.id !== l.id));
  }

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap gap-2.5 rounded-xl2 border border-border bg-surface p-4">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome da lista — ex.: Clientes 2026"
          className={`${inputCls} min-w-[240px] flex-1`}
        />
        <button
          type="button"
          onClick={() => void criar()}
          disabled={salvando || !nome.trim()}
          className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted disabled:shadow-none"
        >
          ＋ Criar lista
        </button>
        {erro && (
          <p className="w-full text-sm text-[#ffb183]" role="alert">
            {erro}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {listas.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            Nenhuma lista ainda. As listas são o público das campanhas de e-mail — crie uma acima e
            importe seus contatos nela.
          </p>
        ) : (
          listas.map((l) => (
            <div key={l.id} className="flex items-center gap-3 border-t border-border px-5 py-3.5 first:border-t-0">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.cor }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{l.nome}</div>
                {l.descricao && <div className="truncate text-xs text-muted">{l.descricao}</div>}
              </div>
              <span className="shrink-0 text-xs text-muted">
                {formatarNumero(l.total ?? 0)} contatos
              </span>
              <button
                type="button"
                onClick={() => void excluir(l)}
                aria-label={`Excluir ${l.nome}`}
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

function Cartao({ label, valor, apoio }: { label: string; valor: string; apoio?: string }) {
  return (
    <div className="rounded-xl2 border border-border bg-surface p-[18px]">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mt-2 font-display text-[26px] font-semibold leading-tight tabular-nums">{valor}</div>
      {apoio && <div className="mt-1 text-[11.5px] text-muted">{apoio}</div>}
    </div>
  );
}
