import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { createServerClient } from '@/lib/supabase/server';
import { lerConfigMeta } from '@/lib/whatsapp/meta-config';
import { lerConfigInstagram, salvarConfigInstagram, urlDeRetorno, urlDoWebhookIg } from '@/lib/instagram/conexao';

export const dynamic = 'force-dynamic';

/** Estado da conexão para a tela. A chave secreta nunca sai — só SE existe. */
export async function GET() {
  const [cfg, meta, { data: contas }] = await Promise.all([
    lerConfigInstagram(),
    lerConfigMeta(),
    createServerClient()
      .from('ig_contas')
      .select('id,ig_user_id,username,nome,foto_url,status,token_expira_em,webhook_assinado_em,ultima_entrada_em,ultimo_erro,criado_em')
      .order('criado_em', { ascending: true }),
  ]);
  return NextResponse.json({
    appId: cfg.appId,
    temSegredo: Boolean(cfg.appSecret),
    urlRetorno: urlDeRetorno(),
    urlWebhook: urlDoWebhookIg(),
    // O verify token não abre nada sozinho; aparece para quem configurar o webhook no painel.
    verifyToken: meta.verifyToken,
    metaConfigurada: Boolean(meta.appId && meta.appSecret),
    contas: contas ?? [],
  });
}

export async function PUT(req: Request) {
  const parsed = await readJson<{ appId?: unknown; appSecret?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const r = await salvarConfigInstagram({
    appId: parsed.data.appId === undefined ? undefined : String(parsed.data.appId ?? ''),
    appSecret: parsed.data.appSecret ? String(parsed.data.appSecret) : undefined,
  });
  if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true });
}
