import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { TIPOS_GATILHO, type TipoGatilho } from '@/lib/automacao/tipos';
import { limparConfig } from '@/lib/automacao/gatilhos';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await createServerClient()
    .from('fluxo_gatilhos')
    .select('*, fluxos(nome,status)')
    .order('prioridade', { ascending: false })
    .order('criado_em');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ gatilhos: data ?? [] });
}

export async function POST(req: Request) {
  const parsed = await readJson<{ fluxo_id?: unknown; tipo?: unknown; config?: unknown; ativo?: unknown; prioridade?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  const tipo = String(b.tipo ?? '') as TipoGatilho;
  if (!TIPOS_GATILHO.includes(tipo)) return NextResponse.json({ error: 'Tipo de gatilho inválido.' }, { status: 400 });
  if (!b.fluxo_id) return NextResponse.json({ error: 'Escolha o fluxo.' }, { status: 400 });
  const limpa = limparConfig(tipo, b.config);
  if ('erro' in limpa) return NextResponse.json({ error: limpa.erro }, { status: 400 });

  const db = createServerClient();
  // Boas-vindas e resposta padrão: só uma de cada ligada — duas brigariam pela mesma
  // mensagem e só a mais antiga responderia, sem ninguém entender por quê.
  if ((tipo === 'boas_vindas' || tipo === 'padrao') && b.ativo !== false) {
    await db.from('fluxo_gatilhos').update({ ativo: false }).eq('tipo', tipo);
  }
  const { data, error } = await db
    .from('fluxo_gatilhos')
    .insert({
      fluxo_id: String(b.fluxo_id),
      tipo,
      config: limpa.config,
      ativo: b.ativo !== false,
      prioridade: Number.isInteger(Number(b.prioridade)) ? Number(b.prioridade) : 0,
    })
    .select('*, fluxos(nome,status)')
    .single();
  if (error) {
    const dup = (error as { code?: string }).code === '23505';
    return NextResponse.json(
      { error: dup ? 'Já existe um link com este código.' : error.message },
      { status: dup ? 409 : 500 },
    );
  }
  return NextResponse.json({ gatilho: data }, { status: 201 });
}
