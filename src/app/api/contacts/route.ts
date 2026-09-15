import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { emailValido, normalizarEmail, separarTags } from '@/lib/contatos';
import { normalizarTelefoneBR, telefoneValido } from '@/lib/whatsapp/jid';

export const dynamic = 'force-dynamic';

/** Teto por página. Protege a tela de tentar desenhar 40 mil linhas de uma vez. */
const POR_PAGINA = 100;

/**
 * Lista contatos com busca, filtro por lista/tag e paginação.
 *
 * A paginação não é enfeite: o PostgREST corta qualquer resposta em 1000 linhas sem
 * avisar, então uma tela "sem paginação" mentiria silenciosamente a partir do
 * milésimo contato.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const busca = (params.get('busca') ?? '').trim();
  const lista = params.get('lista');
  const tag = params.get('tag');
  const status = params.get('status_email');
  const pagina = Math.max(0, Number(params.get('pagina') ?? 0) || 0);

  const supabase = createServerClient();

  // Filtrar por lista exige saber quem são os membros antes — é uma tabela de ligação,
  // e o PostgREST não filtra o principal por uma relação N:N em uma consulta só.
  let idsDaLista: string[] | null = null;
  if (lista) {
    const { data } = await supabase
      .from('list_members')
      .select('contact_id')
      .eq('list_id', lista)
      .limit(1000);
    idsDaLista = ((data ?? []) as { contact_id: string }[]).map((m) => m.contact_id);
    if (!idsDaLista.length) {
      return NextResponse.json({ contatos: [], total: 0, pagina, porPagina: POR_PAGINA });
    }
  }

  let q = supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .order('criado_em', { ascending: false })
    .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);

  if (idsDaLista) q = q.in('id', idsDaLista);
  if (tag) q = q.contains('tags', [tag]);
  if (status) q = q.eq('status_email', status);
  if (busca) {
    // `%` e `,` têm significado dentro do `or` do PostgREST; escapar evita que uma busca
    // por "50%" vire um filtro maluco (ou um erro de sintaxe vindo do servidor).
    const seguro = busca.replace(/[%,()]/g, ' ');
    q = q.or(`nome.ilike.%${seguro}%,email.ilike.%${seguro}%,telefone.ilike.%${seguro}%,empresa.ilike.%${seguro}%`);
  }

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    contatos: data ?? [],
    total: count ?? 0,
    pagina,
    porPagina: POR_PAGINA,
  });
}

export async function POST(req: Request) {
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const email = body.email ? normalizarEmail(String(body.email)) : '';
  const telefone = body.telefone ? normalizarTelefoneBR(String(body.telefone)) : '';

  const errors: { field: string; message: string }[] = [];
  if (email && !emailValido(email)) errors.push({ field: 'email', message: 'E-mail inválido.' });
  if (telefone && !telefoneValido(telefone)) {
    errors.push({ field: 'telefone', message: 'Telefone inválido. Use DDD + número.' });
  }
  if (!email && !telefone) {
    errors.push({ field: 'email', message: 'Informe ao menos um e-mail ou um telefone.' });
  }
  if (errors.length) return NextResponse.json({ errors }, { status: 400 });

  const linha = {
    nome: String(body.nome ?? '').trim() || null,
    email: email || null,
    telefone: telefone || null,
    empresa: String(body.empresa ?? '').trim() || null,
    tags: Array.isArray(body.tags) ? separarTags((body.tags as string[]).join(',')) : separarTags(String(body.tags ?? '')),
    origem: String(body.origem ?? 'manual'),
    campos: (body.campos && typeof body.campos === 'object' ? body.campos : {}) as Record<string, string>,
  };

  const supabase = createServerClient();
  const { data, error } = await supabase.from('contacts').insert(linha).select().single();
  if (error) {
    // 23505 = violação de índice único. Traduzir é o que transforma um 500 opaco num
    // aviso que a pessoa entende e resolve sozinha.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Já existe um contato com esse e-mail ou telefone.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Já entra nas listas escolhidas no formulário.
  if (Array.isArray(body.list_ids) && body.list_ids.length) {
    await supabase.from('list_members').upsert(
      (body.list_ids as string[]).map((list_id) => ({ list_id, contact_id: data.id })),
      { onConflict: 'list_id,contact_id', ignoreDuplicates: true },
    );
  }

  return NextResponse.json(data, { status: 201 });
}
