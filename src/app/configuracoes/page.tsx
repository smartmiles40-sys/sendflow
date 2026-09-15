import { createServerClient } from '@/lib/supabase/server';
import { provedorAtivo } from '@/lib/email/provider';
import { evolutionConfigurada } from '@/lib/whatsapp/evolution';
import { urlPublica, urlPublicaEstavel } from '@/lib/url';
import { loginExigido, segredoConfigurado } from '@/lib/auth';
import { ConfiguracoesClient } from './ConfiguracoesClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Configurações · SendFlow' };

export default async function ConfiguracoesPage() {
  const supabase = createServerClient();
  const { data } = await supabase.from('app_settings').select('*');
  const porChave = Object.fromEntries(
    ((data ?? []) as { chave: string; valor: Record<string, string> }[]).map((r) => [r.chave, r.valor]),
  );

  return (
    <ConfiguracoesClient
      remetente={{
        nome: porChave.email_remetente?.nome ?? '',
        email: porChave.email_remetente?.email ?? '',
        responder_para: porChave.email_remetente?.responder_para ?? '',
        rodape_endereco: porChave.email_remetente?.rodape_endereco ?? '',
        rodape_texto: porChave.email_remetente?.rodape_texto ?? '',
      }}
      ambiente={{
        url_publica: urlPublica(),
        url_estavel: urlPublicaEstavel(),
        evolution: evolutionConfigurada(),
        email: provedorAtivo(),
        login: loginExigido(),
        auth_secret: segredoConfigurado(),
        cron_secret: Boolean(process.env.CRON_SECRET),
        webhook_secret: Boolean(process.env.WEBHOOK_SECRET),
        resend_webhook: Boolean(process.env.RESEND_WEBHOOK_SECRET),
      }}
    />
  );
}
