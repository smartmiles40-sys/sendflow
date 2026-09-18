// Peças de servidor comuns às rotas da tela "Celular".
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Connection } from '@/lib/types';
import { EvolutionError } from './evolution';

/**
 * A conexão pedida, ou a primeira conectada. Devolve a resposta de erro pronta quando
 * não há número para ler — quem chama só repassa.
 */
export async function abrirConexao(
  supabase: SupabaseClient,
  id: string | null,
): Promise<{ conexao: Connection } | { res: NextResponse }> {
  let q = supabase.from('connections').select('*');
  q = id ? q.eq('id', id) : q.eq('status', 'conectada').order('criado_em', { ascending: true });
  const { data } = await q.limit(1);
  const conexao = (data?.[0] ?? null) as Connection | null;
  if (!conexao) {
    return {
      res: NextResponse.json(
        { error: id ? 'Conexão não encontrada.' : 'Nenhum número conectado. Conecte um em Conexões.' },
        { status: 404 },
      ),
    };
  }
  return { conexao };
}

/** Erro da Evolution → resposta HTTP com a mensagem em português. */
export function respostaDeErro(e: unknown): NextResponse {
  const erro = e instanceof EvolutionError ? e : new EvolutionError(String(e));
  // 401/403 da Evolution é chave errada no servidor, não sessão vencida de quem usa a
  // tela — devolver 401 faria o painel achar que precisa de login de novo.
  const s = erro.status;
  const status = s >= 400 && s < 600 && s !== 401 && s !== 403 ? s : 502;
  return NextResponse.json({ error: erro.message }, { status });
}
