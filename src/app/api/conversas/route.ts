import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * A lista da caixa de conversa (o "Live Chat" do ManyChat), mais recentes primeiro.
 *   ?filtro=todas|nao_lidas|pausadas|abertas|fechadas   ?busca=maria   ?conexao=<id>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const filtro = url.searchParams.get('filtro') ?? 'abertas';
  const busca = (url.searchParams.get('busca') ?? '').trim();
  const conexao = url.searchParams.get('conexao');

  const db = createServerClient();
  let q = db
    .from('wa_conversas')
    .select('*, contacts(id,nome,email,tags)')
    .order('ultima_mensagem_em', { ascending: false, nullsFirst: false })
    .limit(200);
  if (conexao) q = q.eq('connection_id', conexao);
  if (filtro === 'nao_lidas') q = q.gt('nao_lidas', 0);
  if (filtro === 'pausadas') q = q.gt('automacao_pausada_ate', new Date().toISOString());
  if (filtro === 'abertas') q = q.eq('status', 'aberta');
  if (filtro === 'fechadas') q = q.eq('status', 'fechada');
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    // Vírgula e parênteses quebram a sintaxe do `or` do PostgREST.
    const termo = busca.replace(/[,()]/g, ' ');
    q = digitos.length >= 4 ? q.ilike('wa_id', `%${digitos}%`) : q.ilike('nome_perfil', `%${termo}%`);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: naoLidas } = await db
    .from('wa_conversas')
    .select('id', { count: 'exact', head: true })
    .gt('nao_lidas', 0);
  return NextResponse.json({ conversas: data ?? [], nao_lidas: naoLidas ?? 0 });
}
