import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { createServerClient } from '@/lib/supabase/server';
import { validarAutomacao } from '@/lib/instagram/regras';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const conta = new URL(req.url).searchParams.get('conta');
  let q = createServerClient().from('ig_automacoes').select('*').order('criado_em', { ascending: true });
  if (conta) q = q.eq('conta_id', conta);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ automacoes: data ?? [] });
}

export async function POST(req: Request) {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const contaId = String(parsed.data.conta_id ?? '');
  if (!contaId) return NextResponse.json({ error: 'Escolha a conta do Instagram.' }, { status: 400 });
  const v = validarAutomacao(parsed.data);
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  const { data, error } = await createServerClient()
    .from('ig_automacoes')
    .insert({ conta_id: contaId, ...v.valor })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
