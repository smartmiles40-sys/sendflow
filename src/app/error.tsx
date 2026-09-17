'use client';

import Link from 'next/link';

/**
 * Tela de erro do painel.
 *
 * Existe por um motivo concreto: sem `NEXT_PUBLIC_SUPABASE_URL` e
 * `SUPABASE_SERVICE_ROLE_KEY`, TODA tela que lê o banco quebra — que é exatamente o
 * estado de quem acabou de clonar o projeto. O primeiro contato com o sistema não
 * pode ser uma pilha de stack trace; tem que ser "falta isto aqui, faça assim".
 *
 * Erro de configuração e erro inesperado recebem tratamentos diferentes: o primeiro
 * tem receita, o segundo tem o texto do erro e um caminho de volta.
 */
export default function Erro({ error, reset }: { error: Error; reset: () => void }) {
  const faltaBanco = /Missing NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/i.test(
    error?.message ?? '',
  );
  const faltaSegredo = /AUTH_SECRET/i.test(error?.message ?? '');

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5">
      <div className="w-full max-w-xl rounded-xl2 border border-border bg-surface p-7">
        {faltaBanco ? (
          <>
            <h1 className="font-display text-xl font-semibold">Falta conectar o banco</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              O sistema está de pé, mas ainda não sabe onde ficam os dados. Crie um projeto no
              Supabase, rode as migrations de <code className="font-mono text-xs">supabase/migrations/</code>{' '}
              em ordem (da 0001 à 0012) e preencha duas variáveis no{' '}
              <code className="font-mono text-xs">.env.local</code>:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface2 p-4 font-mono text-xs leading-relaxed text-muted">
{`NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...`}
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              As duas ficam em <b className="text-ink">Supabase → seu projeto → Settings → API</b>.
              Depois de salvar o arquivo, reinicie o <code className="font-mono">npm run dev</code> —
              variável de ambiente não recarrega sozinha.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              O passo a passo completo está em <code className="font-mono">docs/DEPLOY.md</code>.
            </p>
          </>
        ) : faltaSegredo ? (
          <>
            <h1 className="font-display text-xl font-semibold">Falta o AUTH_SECRET</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              É ele que assina a sessão do login e os links de clique dos e-mails. Gere um e
              coloque no <code className="font-mono text-xs">.env.local</code>:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface2 p-4 font-mono text-xs text-muted">
              openssl rand -hex 32
            </pre>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-semibold">Algo quebrou nesta tela</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              O resto do sistema continua funcionando. Se o erro se repetir, o texto abaixo é o
              que interessa para descobrir a causa.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-xl border border-border bg-surface2 p-4 font-mono text-xs leading-relaxed text-[#ffb183]">
              {error?.message || 'Erro sem mensagem.'}
            </pre>
          </>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue transition-colors hover:bg-blue-hover"
          >
            Tentar de novo
          </button>
          <Link
            href="/configuracoes"
            className="rounded-xl border border-border px-5 py-3 text-sm font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
          >
            Ver o que está faltando
          </Link>
        </div>
      </div>
    </div>
  );
}
