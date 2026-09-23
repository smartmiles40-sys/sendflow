import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import type { TipoGatilho } from '@/lib/automacao/tipos';
import { limparConfig } from '@/lib/automacao/gatilhos';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await readJson<{ config?: unknown; ativo?: unknown; prioridade?: unknown; fluxo_id?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const db = createServerClient();
  const { data: atual } = await db.from('fluxo_gatilhos').select('tipo').eq('id', id).maybeSingle();
  if (!atual) return NextResponse.json({ error: 'Gatilho não encontrado.' }, { status: 404 });
  const tipo = atual.tipo as TipoGatilho;

  const patch: Record<string, unknown> = {};
  if (parsed.data.config !== undefined) {
    const limpa = limparConfig(tipo, parsed.data.config);
    if ('erro' in limpa) return NextResponse.json({ error: limpa.erro }, { status: 400 });
    patch.config = limpa.config;
  }
  if (parsed.data.fluxo_id) patch.fluxo_id = String(parsed.data.fluxo_id);
  if (parsed.data.prioridade !== undefined) patch.prioridade = Number(parsed.data.prioridade) || 0;
  if (typeof parsed.data.ativo === 'boolean') {
    patch.ativo = parsed.data.ativo;
    if (parsed.data.ativo && (tipo === 'boas_vindas' || tipo === 'padrao')) {
      await db.from('fluxo_gatilhos').update({ ativo: false }).eq('tipo', tipo).neq('id', id);
    }
  }

  const { data, error } = await db.from('fluxo_gatilhos').update(patch).eq('id', id).select('*, fluxos(nome,status)').single();
  if (error) {
    const dup = (error as { code?: string }).code === '23505';
    return NextResponse.json({ error: dup ? 'Já existe um link com este código.' : error.message }, { status: dup ? 409 : 500 });
  }
  return NextResponse.json({ gatilho: data });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const { error } = await createServerClient().from('fluxo_gatilhos').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
