import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { emailValido, normalizarEmail, separarTags } from '@/lib/contatos';
import { normalizarTelefoneBR, telefoneValido } from '@/lib/whatsapp/jid';
import { REGRAS_VAZIAS, regrasDosFiltros, somarFiltros, validarRegras, type Regras } from '@/lib/segmentos';
import { filtrarContatos, POR_PAGINA } from '@/lib/segmentos-servidor';

export const dynamic = 'force-dynamic';

/**
 * Lista contatos com busca, filtros rápidos (lista/tag/situação), regras de segmento
 * (`regras` em JSON ou `segmento` = id salvo) e paginação.
 *
 * Tudo vira UMA consulta no banco (sf_filtrar_contatos, 0023). Antes o filtro por lista
 * buscava os ids dos membros e mandava de volta num `in (...)` — e o PostgREST corta em
 * 1000 linhas sem avisar: a lista de 1.500 mostrava 1.000.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const pagina = Math.max(0, Number(params.get('pagina') ?? 0) || 0);
  const supabase = createServerClient();

  let base: Regras = REGRAS_VAZIAS;
  const segmento = params.get('segmento');
  if (segmento) {
    const { data } = await supabase.from('segments').select('regras').eq('id', segmento).maybeSingle();
    if (!data) return NextResponse.json({ error: 'Segmento não encontrado.' }, { status: 404 });
    base = data.regras as Regras;
  } else if (params.get('regras')) {
    let bruto: unknown;
    try {
      bruto = JSON.parse(params.get('regras') ?? '{}');
    } catch {
      return NextResponse.json({ error: 'Regras inválidas.' }, { status: 400 });
    }
    const v = validarRegras(bruto);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
    base = v.regras;
  }

  // Os filtros rápidos sempre somam (E) ao segmento — "deste segmento, só os da lista X".
  // O segmento entra como GRUPO, para um "qualquer" dele não engolir o filtro rápido.
  const rapidos = regrasDosFiltros({ lista: params.get('lista'), tag: params.get('tag'), status_email: params.get('status_email') });
  const regras = somarFiltros(base, rapidos);

  const r = await filtrarContatos(supabase, regras, { busca: params.get('busca'), pagina });
  if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  const { contatos, total } = r;

  return NextResponse.json({ contatos, total, pagina, porPagina: POR_PAGINA });
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
