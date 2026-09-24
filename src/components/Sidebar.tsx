'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from './Logo';

/**
 * Navegação em 3 MÓDULOS (24/09/2026): Gestão de Grupos, ManyChat e E-mail.
 *
 * O corte não é por canal técnico (Evolution x Cloud API), é por TRABALHO: quem cuida
 * das lives e dos grupos vive no primeiro; quem cuida de robô, conversa e disparo em
 * massa oficial vive no segundo; e-mail marketing é o terceiro. Contatos e Conexões
 * ficam fora porque servem aos três.
 */
const grupos: { titulo: string | null; itens: { href: string; label: string; icon: string }[] }[] = [
  {
    titulo: null,
    itens: [{ href: '/painel', label: 'Painel', icon: '📊' }],
  },
  {
    titulo: 'Gestão de Grupos',
    itens: [
      { href: '/grupos', label: 'Grupos', icon: '👥' },
      { href: '/campanhas', label: 'Campanhas', icon: '📣' },
      { href: '/cadencias', label: 'Cadências', icon: '🧭' },
      { href: '/sequencias', label: 'Sequências', icon: '🔁' },
      { href: '/recorrencias', label: 'Recorrentes', icon: '🔄' },
      { href: '/publicos', label: 'Públicos', icon: '⭐' },
      { href: '/celular', label: 'Celular', icon: '📱' },
    ],
  },
  {
    titulo: 'ManyChat',
    itens: [
      { href: '/conversas', label: 'Conversas', icon: '💬' },
      { href: '/automacoes', label: 'Automações', icon: '⚡' },
      { href: '/disparos', label: 'Disparo em massa', icon: '🚀' },
    ],
  },
  {
    titulo: 'E-mail',
    itens: [
      { href: '/email', label: 'Campanhas', icon: '✉️' },
      { href: '/email/conexao', label: 'Conexão', icon: '🔗' },
    ],
  },
  {
    titulo: 'Base',
    itens: [{ href: '/contatos', label: 'Contatos e listas', icon: '📇' }],
  },
  {
    titulo: 'Sistema',
    itens: [
      { href: '/conexoes', label: 'Conexões', icon: '🔌' },
      { href: '/configuracoes', label: 'Configurações', icon: '⚙️' },
    ],
  },
];

interface ResumoConexoes {
  conectadas: number;
  total: number;
}

export function Sidebar() {
  const path = usePathname() ?? '';
  const router = useRouter();
  const [conexoes, setConexoes] = useState<ResumoConexoes | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  // Ativo = o item de caminho MAIS LONGO que casa: em /email/conexao acende "Conexão",
  // não "Campanhas" (/email) também.
  const ativo = grupos
    .flatMap((g) => g.itens.map((i) => i.href))
    .filter((h) => path === h || path.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];

  // O rodapé mostra o estado real dos números. Antes havia ali um selo fixo dizendo
  // "Motor n8n + Z-API" — decorativo, e que continuaria verde com tudo desconectado.
  useEffect(() => {
    if (path === '/login') return;
    let ativo = true;
    fetch('/api/connections')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!ativo || !body?.conexoes) return;
        const lista = body.conexoes as { status: string }[];
        setConexoes({
          conectadas: lista.filter((c) => c.status === 'conectada').length,
          total: lista.length,
        });
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [path]);

  // O login é tela cheia, sem navegação: não há para onde ir antes de entrar.
  if (path === '/login') return null;

  async function sair() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      {/* No celular a barra lateral fixa de 240px sobrava ~70px de conteúdo: o texto quebrava
          uma palavra por linha. Abaixo de md ela vira uma gaveta, aberta por este cabeçalho. */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center gap-2 border-b border-border bg-surface px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setMenuAberto((v) => !v)}
          aria-expanded={menuAberto}
          aria-controls="menu-principal"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-ink transition-colors hover:bg-blue/10"
        >
          <span className="sr-only">{menuAberto ? 'Fechar menu' : 'Abrir menu'}</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {menuAberto ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <Logo />
      </header>

      {menuAberto && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMenuAberto(false)}
          className="fixed inset-0 z-40 bg-bg/70 md:hidden"
        />
      )}

      <aside
        id="menu-principal"
        className={`fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-gradient-to-b from-surface to-bg p-4 transition-transform duration-200 ease-out md:static md:min-h-screen md:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="md:block">
          <Logo />
        </div>

      <nav className="flex flex-col gap-5">
        {grupos.map((grupo, i) => (
          <div key={grupo.titulo ?? `g${i}`} className="flex flex-col gap-1">
            {grupo.titulo && (
              <h2 className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/70">
                {grupo.titulo}
              </h2>
            )}
            {grupo.itens.map((it) => {
              const active = it.href === ativo;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? 'page' : undefined}
                  // No celular a gaveta cobre a tela: escolher um destino fecha ela.
                  onClick={() => setMenuAberto(false)}
                  className={`flex items-center gap-[11px] rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active ? 'bg-blue/15 text-ink' : 'text-muted hover:bg-white/5 hover:text-ink'
                  }`}
                >
                  <span
                    className={`text-base leading-none ${active ? 'opacity-100' : 'opacity-85'}`}
                    aria-hidden="true"
                  >
                    {it.icon}
                  </span>
                  {it.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <Link
          href="/conexoes"
          className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted transition-colors hover:border-blue2"
        >
          <EstadoConexoes resumo={conexoes} />
        </Link>
        <button
          type="button"
          onClick={() => void sair()}
          className="rounded-xl px-3 py-2 text-left text-xs font-medium text-muted transition-colors hover:bg-white/5 hover:text-ink"
        >
          Sair
        </button>
      </div>
      </aside>
    </>
  );
}

function EstadoConexoes({ resumo }: { resumo: ResumoConexoes | null }) {
  if (!resumo) {
    return <span className="text-muted">Verificando conexões…</span>;
  }
  if (resumo.total === 0) {
    return (
      <>
        <Ponto cor="bg-orange" />
        Nenhum número conectado
        <br />
        <span className="text-muted/80">Clique para conectar o primeiro</span>
      </>
    );
  }
  const tudoOk = resumo.conectadas === resumo.total;
  return (
    <>
      <Ponto cor={resumo.conectadas === 0 ? 'bg-orange' : tudoOk ? 'bg-green' : 'bg-blue2'} />
      {resumo.conectadas} de {resumo.total} número{resumo.total > 1 ? 's' : ''} conectado
      {resumo.conectadas === 1 && resumo.total === 1 ? '' : 's'}
      <br />
      <span className="text-muted/80">API oficial da Meta · Evolution</span>
    </>
  );
}

function Ponto({ cor }: { cor: string }) {
  return <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${cor} shadow-[0_0_8px_currentColor]`} />;
}
