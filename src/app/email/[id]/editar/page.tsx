import Link from 'next/link';
import { carregarDadosEditor } from '@/lib/email/carregar';
import { EmailEditor } from '@/components/EmailEditor';

export const dynamic = 'force-dynamic';

export default async function EditarCampanhaEmailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dados = await carregarDadosEditor(id);

  if (!dados.campanha) {
    return (
      <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
        Campanha não encontrada.{' '}
        <Link href="/email" className="font-semibold text-blue2 hover:underline">
          Voltar para a lista
        </Link>
      </div>
    );
  }

  // Campanha que já saiu é histórico: o HTML guardado é a prova do que as pessoas
  // receberam, e reescrever isso apagaria a única cópia.
  if (dados.campanha.status === 'enviando' || dados.campanha.status === 'enviada') {
    return (
      <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
        Esta campanha já foi enviada e não pode mais ser alterada.{' '}
        <Link href={`/email/${id}`} className="font-semibold text-blue2 hover:underline">
          Ver os resultados
        </Link>
      </div>
    );
  }

  return <EmailEditor dados={dados} />;
}
