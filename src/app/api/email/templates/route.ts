import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Os modelos prontos (semeados na migration 0011) + os que a equipe salvar. */
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .order('criado_em', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** Salva o e-mail atual como modelo reutilizável. */
export async function POST(req: Request) {
  const parsed = await readJson<{ nome?: unknown; descricao?: unknown; html?: unknown; assunto_sugerido?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const nome = String(body.nome ?? '').trim();
  const html = String(body.html ?? '');
  if (!nome) {
    return NextResponse.json({ errors: [{ field: 'nome', message: 'Dê um nome ao modelo.' }] }, { status: 400 });
  }
  if (!html.trim()) {
    return NextResponse.json({ errors: [{ field: 'html', message: 'O modelo está vazio.' }] }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('email_templates')
    .insert({
      nome,
      descricao: String(body.descricao ?? '').trim() || null,
      assunto_sugerido: String(body.assunto_sugerido ?? '').trim() || null,
      html,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
