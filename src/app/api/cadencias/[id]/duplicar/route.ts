import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { nomeDoPasso } from '@/lib/cadencia';

export const dynamic = 'force-dynamic';

/**
 * Cria a PRÓXIMA cadência a partir desta: mesmo destino, mesmas mensagens, todas as
 * datas empurradas N dias. É o "criar as próximas" — a live da semana que vem é a
 * desta semana com outra data.
 *
 * As cópias nascem em rascunho (pausadas) de propósito: quem duplica quase sempre vai
 * trocar texto ou tema antes, e uma cópia já agendada sairia com o conteúdo velho.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<{ nome?: unknown; dias?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const nome = String(parsed.data.nome ?? '').trim();
  const dias = Number(parsed.data.dias);
  if (!nome) {
    return NextResponse.json({ errors: [{ field: 'nome', message: 'Dê um nome à nova cadência.' }] }, { status: 400 });
  }
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) {
    return NextResponse.json({ errors: [{ field: 'dias', message: 'Use um número de dias entre 0 e 365.' }] }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: origem } = await supabase.from('cadencias').select('*').eq('id', id).maybeSingle();
  if (!origem) return NextResponse.json({ error: 'Cadência não encontrada.' }, { status: 404 });

  const { data: nova, error } = await supabase
    .from('cadencias')
    .insert({
      nome,
      categoria: origem.categoria,
      alvo: origem.alvo,
      audience_id: origem.audience_id,
      group_ids: origem.group_ids,
      list_ids: origem.list_ids,
      connection_id: origem.connection_id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: passos } = await supabase
    .from('campaigns')
    .select('tipo,mensagem,midia_url,mencionar_todos,enquete_opcoes,enquete_multipla,enviar_em')
    .eq('cadencia_id', id)
    .order('enviar_em', { ascending: true });

  const copias = (passos ?? [])
    .filter((p) => p.enviar_em)
    .map((p) => {
      const enviarEm = new Date(new Date(p.enviar_em as string).getTime() + dias * 86_400_000).toISOString();
      return {
        cadencia_id: nova.id,
        nome: nomeDoPasso(nome, enviarEm),
        categoria: nova.categoria,
        tipo: p.tipo,
        mensagem: p.mensagem,
        midia_url: p.midia_url,
        mencionar_todos: p.mencionar_todos,
        enquete_opcoes: p.enquete_opcoes,
        enquete_multipla: p.enquete_multipla,
        alvo: nova.alvo,
        audience_id: nova.audience_id,
        group_ids: nova.group_ids,
        list_ids: nova.list_ids,
        connection_id: nova.connection_id,
        enviar_em: enviarEm,
        status: 'rascunho',
      };
    });
  if (copias.length) {
    const { error: erroCopia } = await supabase.from('campaigns').insert(copias);
    if (erroCopia) {
      await supabase.from('cadencias').delete().eq('id', nova.id);
      return NextResponse.json({ error: erroCopia.message }, { status: 500 });
    }
  }
  return NextResponse.json(nova, { status: 201 });
}
