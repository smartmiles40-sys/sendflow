'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Contact, Lista } from '@/lib/types';
import { inputCls } from '@/components/ui';
import { formatarNumero } from '@/lib/kpis';
import { formatarTelefone } from '@/lib/whatsapp/jid';
import { ImportarContatos } from './ImportarContatos';

type Aba = 'contatos' | 'listas';

export function ContatosClient({
  inicial,
  total,
  listas: listasIniciais,
  resumo,
}: {
  inicial: Contact[];
  total: number;
  listas: Lista[];
  resumo: { comEmail: number; comWhatsApp: number; descadastrados: number };
}) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('contatos');
  const [listas, setListas] = useState(listasIniciais);
  const [importando, setImportando] = useState(false);

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

      {aba === 'contatos' ? (
        <TabelaContatos inicial={inicial} total={total} listas={listas} />
      ) : (
        <Listas listas={listas} onMudou={setListas} />
      )}

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
}: {
  inicial: Contact[];
  total: number;
  listas: Lista[];
}) {
  const [contatos, setContatos] = useState(inicial);
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState('');
  const [pagina, setPagina] = useState(0);
  const [totalFiltrado, setTotalFiltrado] = useState(total);
  const [carregando, setCarregando] = useState(false);

  // Busca com atraso de 300 ms: sem isso, cada tecla vira uma consulta, e num campo
  // de busca isso é uma consulta por letra digitada.
  useEffect(() => {
    const timer = setTimeout(async () => {
      setCarregando(true);
      try {
        const params = new URLSearchParams({ pagina: String(pagina) });
        if (busca.trim()) params.set('busca', busca.trim());
        if (lista) params.set('lista', lista);
        const res = await fetch(`/api/contacts?${params}`);
        if (res.ok) {
          const body = await res.json();
          setContatos(body.contatos);
          setTotalFiltrado(body.total);
        }
      } finally {
        setCarregando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [busca, lista, pagina]);

  const porPagina = 100;
  const paginas = Math.ceil(totalFiltrado / porPagina);

  return (
    <div>
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
      </div>

      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        {contatos.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            {busca || lista
              ? 'Nenhum contato com esse filtro.'
              : 'Nenhum contato ainda. Use o botão Importar CSV para trazer sua base.'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[2fr_2fr_1.4fr_1fr] gap-3 bg-surface2 px-[18px] py-[11px] text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              <div>Nome</div>
              <div>E-mail</div>
              <div>WhatsApp</div>
              <div>Situação</div>
            </div>
            {contatos.map((c) => (
              <div
                key={c.id}
                className="grid grid-cols-[2fr_2fr_1.4fr_1fr] items-center gap-3 border-t border-border px-[18px] py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate">{c.nome || <span className="text-muted">sem nome</span>}</div>
                  {c.empresa && <div className="truncate text-xs text-muted">{c.empresa}</div>}
                </div>
                <div className="truncate text-muted">{c.email ?? '—'}</div>
                <div className="truncate tabular-nums text-muted">
                  {c.telefone ? formatarTelefone(c.telefone) : '—'}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Selo status={c.status_email} canal="e-mail" />
                  {c.telefone && <Selo status={c.status_whatsapp} canal="WhatsApp" />}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 text-xs text-muted">
        <span>
          {carregando ? 'Buscando…' : `${formatarNumero(totalFiltrado)} contato(s)`}
        </span>
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
