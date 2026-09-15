import { createServerClient } from '@/lib/supabase/server';
import type { Contact, Lista } from '@/lib/types';
import { ContatosClient } from './ContatosClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Contatos · SendFlow' };

export default async function ContatosPage() {
  const supabase = createServerClient();

  const [{ data: listas }, { data: contatos, count }] = await Promise.all([
    supabase.from('lists').select('*').order('nome', { ascending: true }),
    supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('criado_em', { ascending: false })
      .range(0, 99),
  ]);

  const comTotal = await Promise.all(
    ((listas ?? []) as Lista[]).map(async (l) => {
      const { count: n } = await supabase
        .from('list_members')
        .select('contact_id', { count: 'exact', head: true })
        .eq('list_id', l.id);
      return { ...l, total: n ?? 0 };
    }),
  );

  // Panorama da base: quantos dão para alcançar em cada canal. É o número que a
  // pessoa precisa antes de montar qualquer campanha.
  const [{ count: comEmail }, { count: comWhats }, { count: descadastrados }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .not('email', 'is', null)
      .eq('status_email', 'ativo'),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .not('telefone', 'is', null)
      .eq('status_whatsapp', 'ativo'),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .in('status_email', ['descadastrado', 'bounce', 'spam']),
  ]);

  return (
    <ContatosClient
      inicial={(contatos ?? []) as Contact[]}
      total={count ?? 0}
      listas={comTotal}
      resumo={{
        comEmail: comEmail ?? 0,
        comWhatsApp: comWhats ?? 0,
        descadastrados: descadastrados ?? 0,
      }}
    />
  );
}
