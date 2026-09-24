import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { ig } from '@/lib/instagram/api';

export const dynamic = 'force-dynamic';

/** Os posts e reels recentes da conta — para escolher em quais o robô responde comentário. */
export async function GET(req: Request) {
  const contaId = new URL(req.url).searchParams.get('conta');
  if (!contaId) return NextResponse.json({ error: 'Informe a conta.' }, { status: 400 });
  const { data: conta } = await createServerClient().from('ig_contas').select('ig_user_id').eq('id', contaId).maybeSingle();
  if (!conta) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
  try {
    const r = await ig<{ data?: Record<string, unknown>[] }>(
      `/${conta.ig_user_id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=30`,
      { conta: conta.ig_user_id },
    );
    return NextResponse.json({ midias: r.data ?? [] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
