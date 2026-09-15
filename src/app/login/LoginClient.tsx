'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { inputCls } from '@/components/ui';

export function LoginClient({ configurado }: { configurado: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setErro(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, senha }),
      });
      if (res.ok) {
        // `de` guarda para onde a pessoa ia antes de cair no login. Só aceitamos um
        // caminho interno: um `de=https://site-falso` viraria redirecionamento aberto
        // logo depois de um login bem-sucedido, que é quando a pessoa mais confia.
        const de = params.get('de') ?? '';
        const destino = de.startsWith('/') && !de.startsWith('//') ? de : '/painel';
        router.replace(destino);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setErro(body.error ?? 'Não foi possível entrar.');
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex justify-center">
          <Logo />
        </div>

        <form
          onSubmit={entrar}
          className="rounded-xl2 border border-border bg-surface p-7 shadow-[0_24px_60px_rgba(0,0,0,.45)]"
        >
          <h1 className="mb-1.5 font-display text-xl font-semibold tracking-[-0.01em]">Entrar</h1>
          <p className="mb-6 text-sm text-muted">Acesso restrito à equipe.</p>

          {!configurado && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-[13px] leading-relaxed text-[#ffb183]"
            >
              <strong className="font-semibold">Login não configurado.</strong> Defina{' '}
              <code className="font-mono text-xs">AUTH_SECRET</code> e{' '}
              <code className="font-mono text-xs">APP_USERS</code> nas variáveis de ambiente.
              Enquanto isso, o painel fica aberto para qualquer pessoa com o endereço.
            </div>
          )}

          <label className="mb-4 block">
            <span className="mb-[9px] block text-[13px] font-semibold">Usuário</span>
            <input
              type="email"
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="voce@empresa.com.br"
              className={inputCls}
              required
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-[9px] block text-[13px] font-semibold">Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={inputCls}
              required
            />
          </label>

          {erro && (
            <p className="mb-4 text-sm text-[#ffb183]" role="alert">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={entrando || !usuario || !senha}
            className="w-full rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(1,71,255,.35)] transition-colors hover:bg-[#0a54ff] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
