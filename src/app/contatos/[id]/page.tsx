import { notFound } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import type { Contact } from '@/lib/types';
import { FichaContato, type EventoContato } from './FichaContato';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Contato · SendFlow' };

export default async function ContatoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: contato } = await supabase.from('contacts').select('*').eq('id', id).maybeSingle();
  if (!contato) notFound();

  const [{ data: eventos }, { data: membros }, { data: listas }, { data: campos }, { data: emails }] = await Promise.all([
    supabase
      .from('contact_eventos')
      .select('id,tipo,detalhe,criado_em')
      .eq('contact_id', id)
      .order('criado_em', { ascending: false })
      .limit(200),
    supabase.from('list_members').select('list_id').eq('contact_id', id),
    supabase.from('lists').select('id,nome,cor').order('nome', { ascending: true }),
    supabase.from('contact_fields').select('chave,rotulo,tipo').order('rotulo', { ascending: true }),
    supabase
      .from('email_recipients')
      .select('campaign_id,status,enviado_em,primeiro_aberto_em,primeiro_clique_em,aberturas,cliques')
      .eq('contact_id', id)
      .order('enviado_em', { ascending: false })
      .limit(50),
  ]);

  // Nome das campanhas citadas nos eventos e no histórico, numa consulta só.
  const idsCampanha = new Set<string>();
  for (const e of (eventos ?? []) as EventoContato[]) {
    const c = (e.detalhe as { campaign_id?: string }).campaign_id;
    if (c) idsCampanha.add(c);
  }
  for (const r of (emails ?? []) as { campaign_id: string }[]) idsCampanha.add(r.campaign_id);
  const { data: campanhas } = idsCampanha.size
    ? await supabase.from('email_campaigns').select('id,nome').in('id', [...idsCampanha])
    : { data: [] };

  return (
    <FichaContato
      contato={contato as Contact}
      eventos={(eventos ?? []) as EventoContato[]}
      listaIds={((membros ?? []) as { list_id: string }[]).map((m) => m.list_id)}
      listas={(listas ?? []) as { id: string; nome: string; cor: string }[]}
      campos={(campos ?? []) as { chave: string; rotulo: string; tipo: string }[]}
      emails={
        (emails ?? []) as {
          campaign_id: string;
          status: string;
          enviado_em: string | null;
          primeiro_aberto_em: string | null;
          primeiro_clique_em: string | null;
          aberturas: number;
          cliques: number;
        }[]
      }
      nomesCampanha={Object.fromEntries(((campanhas ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]))}
    />
  );
}
