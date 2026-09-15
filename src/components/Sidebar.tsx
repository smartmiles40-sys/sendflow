'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from './Logo';

/**
 * Navegação agrupada por CANAL, e não por tipo de tela.
 *
 * O sistema cresceu de "disparador de WhatsApp" para dois canais mais uma base de
 * contatos compartilhada. Uma lista plana de nove itens esconderia a coisa mais
 * importante da nova estrutura: e-mail e WhatsApp são irmãos, e os contatos servem aos
 * dois. O painel fica fora dos grupos porque é o destino padrão, não um canal.
 */
const grupos: { titulo: string | null; itens: { href: string; label: string; icon: string }[] }[] = [
  {
    titulo: null,
    itens: [{ href: '/painel', label: 'Painel', icon: '📊' }],
  },
  {
    titulo: 'WhatsApp',
    itens: [
      { href: '/campanhas', label: 'Campanhas', icon: '📣' },
      { href: '/sequencias', label: 'Sequências', icon: '🔁' },
      { href: '/recorrencias', label: 'Recorrentes', icon: '🔄' },
      { href: '/grupos', label: 'Grupos', icon: '👥' },
      { href: '/publicos', label: 'Públicos', icon: '⭐' },
    ],
  },
  {
    titulo: 'E-mail',
    itens: [{ href: '/email', label: 'Campanhas', icon: '✉️' }],
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
    <aside className="flex min-h-screen w-60 shrink-0 flex-col gap-6 border-r border-border bg-gradient-to-b from-[#080C18] to-[#05080F] p-4">
      <Logo />

      <nav className="flex flex-col gap-5">
        {grupos.map((grupo, i) => (
          <div key={grupo.titulo ?? `g${i}`} className="flex flex-col gap-1">
            {grupo.titulo && (
              <h2 className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/70">
                {grupo.titulo}
              </h2>
            )}
            {grupo.itens.map((it) => {
              const active = path === it.href || path.startsWith(`${it.href}/`);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? 'page' : undefined}
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
      <span className="text-muted/80">Motor próprio · Evolution API</span>
    </>
  );
}

function Ponto({ cor }: { cor: string }) {
  return <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${cor} shadow-[0_0_8px_currentColor]`} />;
}
