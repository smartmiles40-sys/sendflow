import { createServerClient } from '@/lib/supabase/server';
import { provedorAtivo } from '@/lib/email/provider';
import { evolutionConfigurada } from '@/lib/whatsapp/evolution';
import { cloudConfigurada } from '@/lib/whatsapp/meta-config';
import { urlPublica, urlPublicaEstavel } from '@/lib/url';
import { loginExigido, segredoConfigurado } from '@/lib/auth';
import { lerConfigEmail } from '@/lib/email/config';
import { ConfiguracoesClient } from './ConfiguracoesClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Configurações · SendFlow' };

export default async function ConfiguracoesPage() {
  /**
   * Esta é a ÚNICA tela que precisa funcionar com o banco fora do ar.
   *
   * O trabalho dela é dizer o que está faltando — e "o banco não está configurado" é
   * justamente o caso mais comum de quem acabou de clonar o projeto. Quebrar aqui
   * seria o diagnóstico exigindo aquilo que ele deveria diagnosticar.
   */
  let porChave: Record<string, Record<string, string>> = {};
  // A janela de horário e o vigia moram em `app_settings.envio` (ver 0011 e 0019).
  let banco = true;
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase.from('app_settings').select('*');
    if (error) throw new Error(error.message);
    porChave = Object.fromEntries(
      ((data ?? []) as { chave: string; valor: Record<string, string> }[]).map((r) => [r.chave, r.valor]),
    );
  } catch {
    banco = false;
  }

  return (
    <ConfiguracoesClient
      remetente={{
        nome: porChave.email_remetente?.nome ?? '',
        email: porChave.email_remetente?.email ?? '',
        responder_para: porChave.email_remetente?.responder_para ?? '',
        rodape_endereco: porChave.email_remetente?.rodape_endereco ?? '',
        rodape_texto: porChave.email_remetente?.rodape_texto ?? '',
      }}
      envio={{
        janela_inicio: porChave.envio?.janela_inicio ?? '08:00',
        janela_fim: porChave.envio?.janela_fim ?? '21:00',
        respeitar_janela: Boolean(porChave.envio?.respeitar_janela),
        lote_whatsapp: Number(porChave.envio?.lote_whatsapp ?? 200),
        alerta_email: porChave.envio?.alerta_email ?? '',
      }}
      ambiente={{
        banco,
        url_publica: urlPublica(),
        url_estavel: urlPublicaEstavel(),
        evolution: evolutionConfigurada(),
        oficial: await cloudConfigurada(),
        email: await provedorAtivo(),
        login: loginExigido(),
        auth_secret: segredoConfigurado(),
        cron_secret: Boolean(process.env.CRON_SECRET),
        webhook_secret: Boolean(process.env.WEBHOOK_SECRET),
        resend_webhook: Boolean((await lerConfigEmail()).resendWebhookSecret),
      }}
    />
  );
}
