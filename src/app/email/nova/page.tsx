import { carregarDadosEditor } from '@/lib/email/carregar';
import { EmailEditor } from '@/components/EmailEditor';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Nova campanha de e-mail · SendFlow' };

export default async function NovaCampanhaEmailPage() {
  return <EmailEditor dados={await carregarDadosEditor()} />;
}
