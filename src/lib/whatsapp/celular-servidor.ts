// Peças de servidor comuns às rotas da tela "Celular".
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Connection } from '@/lib/types';
import { EvolutionError } from './evolution';

/** A mídia é do nosso Storage? A rota de envio não pode virar um "manda qualquer URL". */
export function midiaDoSendflow(url: string, supabaseUrl: string): boolean {
  const base = supabaseUrl.replace(/\/+$/, '');
  return Boolean(base) && url.startsWith(`${base}/storage/v1/object/public/`);
}

/**
 * Uma conexão que tem instância na Evolution. O tipo existe para o compilador cobrar
 * a verificação: `instance_name` é nulo nas conexões da API oficial, e toda rota do
 * Celular precisa de uma instância para funcionar.
 */
export type ConexaoEvolution = Connection & { instance_name: string };

/**
 * A conexão pedida, ou a primeira conectada. Devolve a resposta de erro pronta quando
 * não há número para ler — quem chama só repassa.
 *
 * Só devolve conexão da EVOLUTION, e de propósito: a tela Celular lê conversas,
 * mensagens e grupos de um aparelho. A API oficial da Meta não expõe nada disso — ela
 * entrega mensagens por webhook e não tem "histórico de conversa" para consultar.
 * Deixar um número oficial chegar aqui daria 404 da Evolution em vez de uma explicação.
 */
export async function abrirConexao(
  supabase: SupabaseClient,
  id: string | null,
): Promise<{ conexao: ConexaoEvolution } | { res: NextResponse }> {
  let q = supabase.from('connections').select('*').eq('provider', 'evolution');
  q = id ? q.eq('id', id) : q.eq('status', 'conectada').order('criado_em', { ascending: true });
  const { data } = await q.limit(1);
  const conexao = (data?.[0] ?? null) as Connection | null;
  if (!conexao || !conexao.instance_name) {
    return {
      res: NextResponse.json(
        {
          error: id
            ? 'Esta conexão não é um número conectado por QR Code. A tela Celular só funciona com chip (Evolution).'
            : 'Nenhum chip conectado. Conecte um número por QR Code em Conexões.',
        },
        { status: 404 },
      ),
    };
  }
  return { conexao: conexao as ConexaoEvolution };
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
