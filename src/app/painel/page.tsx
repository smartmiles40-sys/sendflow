import { createServerClient } from '@/lib/supabase/server';
import { carregarPainel } from '@/lib/painel';
import { PainelClient } from './PainelClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Painel · SendFlow' };

export default async function PainelPage() {
  const supabase = createServerClient();
  const dados = await carregarPainel(supabase, 30);
  return <PainelClient inicial={dados} />;
}
