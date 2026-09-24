import { ConexaoEmailClient } from './ConexaoEmailClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Conexão de e-mail · SendFlow' };

export default function ConexaoEmailPage() {
  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Conexão de e-mail</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
          O SendFlow manda os e-mails pelo <b className="text-ink">Resend</b>. Conecte uma vez: chave, domínio e webhook —
          tudo por aqui, sem mexer na Vercel.
        </p>
      </header>
      <ConexaoEmailClient />
    </div>
  );
}
