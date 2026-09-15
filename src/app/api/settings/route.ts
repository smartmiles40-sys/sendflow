import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { provedorAtivo } from '@/lib/email/provider';
import { evolutionConfigurada } from '@/lib/whatsapp/evolution';
import { urlPublica, urlPublicaEstavel } from '@/lib/url';

export const dynamic = 'force-dynamic';

/**
 * Configurações + um diagnóstico do ambiente.
 *
 * O diagnóstico existe porque metade dos problemas deste tipo de sistema é variável de
 * ambiente faltando, e o sintoma sempre aparece longe da causa: "a campanha não sai"
 * (falta EVOLUTION_API_URL), "os KPIs estão zerados" (falta AUTH_SECRET, então os links
 * não assinam), "os links do e-mail quebraram depois do deploy" (falta APP_URL).
 * Mostrar isso numa tela evita cada uma dessas caçadas.
 */
export async function GET() {
  const supabase = createServerClient();
  const { data } = await supabase.from('app_settings').select('*');
  const porChave = Object.fromEntries(((data ?? []) as { chave: string; valor: unknown }[]).map((r) => [r.chave, r.valor]));

  return NextResponse.json({
    settings: porChave,
    ambiente: {
      url_publica: urlPublica(),
      url_estavel: urlPublicaEstavel(),
      evolution: evolutionConfigurada(),
      email: provedorAtivo(),
      auth_secret: Boolean((process.env.AUTH_SECRET ?? '').length >= 16),
      cron_secret: Boolean(process.env.CRON_SECRET),
      webhook_secret: Boolean(process.env.WEBHOOK_SECRET),
      resend_webhook: Boolean(process.env.RESEND_WEBHOOK_SECRET),
    },
  });
}

export async function PATCH(req: Request) {
  const parsed = await readJson<{ chave?: unknown; valor?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const chave = String(parsed.data.chave ?? '').trim();
  const valor = parsed.data.valor;

  // Lista fechada: `app_settings` é chave/valor livre, mas a API só deixa escrever nas
  // chaves que o sistema conhece — senão vira depósito de qualquer coisa.
  const PERMITIDAS = ['email_remetente', 'envio'];
  if (!PERMITIDAS.includes(chave)) {
    return NextResponse.json({ error: 'Configuração desconhecida.' }, { status: 400 });
  }
  if (!valor || typeof valor !== 'object') {
    return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('app_settings')
    .upsert({ chave, valor }, { onConflict: 'chave' })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
