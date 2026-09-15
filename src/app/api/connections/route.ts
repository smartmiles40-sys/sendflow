import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { criarInstancia, EvolutionError, evolutionConfigurada } from '@/lib/whatsapp/evolution';
import { nomeDeInstancia, urlDoWebhook } from '@/lib/whatsapp/conexao';
import type { Connection } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .order('criado_em', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conexoes: data ?? [], configurada: evolutionConfigurada() });
}

/**
 * Cria a conexão: registra a instância na Evolution (já apontando o webhook para cá)
 * e guarda a linha no banco. Devolve o primeiro QR Code para a tela mostrar na hora.
 */
export async function POST(req: Request) {
  const parsed = await readJson<{ nome?: unknown; delay_min_seg?: unknown; delay_max_seg?: unknown; limite_diario?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const nome = String(body.nome ?? '').trim();
  if (!nome) {
    return NextResponse.json({ errors: [{ field: 'nome', message: 'Dê um nome à conexão.' }] }, { status: 400 });
  }
  if (!evolutionConfigurada()) {
    return NextResponse.json(
      { error: 'Evolution API não configurada. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY.' },
      { status: 503 },
    );
  }

  const delayMin = Number(body.delay_min_seg ?? 8);
  const delayMax = Number(body.delay_max_seg ?? 15);
  if (!Number.isInteger(delayMin) || !Number.isInteger(delayMax) || delayMin < 1 || delayMax < delayMin) {
    return NextResponse.json(
      { errors: [{ field: 'delay_min_seg', message: 'Intervalo inválido: o mínimo precisa ser ≥ 1s e ≤ o máximo.' }] },
      { status: 400 },
    );
  }

  const instanceName = nomeDeInstancia(nome);
  const webhookUrl = urlDoWebhook();

  let qrcode;
  try {
    qrcode = await criarInstancia(instanceName, webhookUrl);
  } catch (e) {
    const erro = e instanceof EvolutionError ? e : new EvolutionError(String(e));
    return NextResponse.json({ error: erro.message }, { status: erro.status || 502 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('connections')
    .insert({
      nome,
      instance_name: instanceName,
      status: 'conectando',
      delay_min_seg: delayMin,
      delay_max_seg: delayMax,
      limite_diario: Number.isInteger(Number(body.limite_diario)) ? Number(body.limite_diario) : 500,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ conexao: data as Connection, qrcode }, { status: 201 });
}
