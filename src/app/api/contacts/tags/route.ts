import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { separarTags } from '@/lib/contatos';

export const dynamic = 'force-dynamic';

/** Todas as tags de contato com quantos contatos têm cada uma. */
export async function GET() {
  const { data, error } = await createServerClient().rpc('sf_tags_contato');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tags: ((data ?? []) as { tag: string; total: number }[]).map((t) => ({ tag: t.tag, total: Number(t.total) })) });
}

/** Renomeia em toda a base. Renomear para uma tag que já existe = juntar as duas. */
export async function PATCH(req: Request) {
  const parsed = await readJson<{ de?: unknown; para?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const de = String(parsed.data.de ?? '');
  // Mesma normalização do CSV e da ficha do contato — senão "VIP" e "vip" viram duas.
  const para = separarTags(String(parsed.data.para ?? ''))[0] ?? '';
  if (!de || !para) return NextResponse.json({ error: 'Informe a tag e o nome novo.' }, { status: 400 });
  const { data, error } = await createServerClient().rpc('sf_renomear_tag', { p_de: de, p_para: para });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, contatos: data, para });
}

/** Tira a tag de todos os contatos. */
export async function DELETE(req: Request) {
  const tag = new URL(req.url).searchParams.get('tag') ?? '';
  if (!tag) return NextResponse.json({ error: 'Informe a tag.' }, { status: 400 });
  const { data, error } = await createServerClient().rpc('sf_apagar_tag', { p_tag: tag });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, contatos: data });
}
