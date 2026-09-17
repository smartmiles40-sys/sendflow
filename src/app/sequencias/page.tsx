import { createServerClient } from '@/lib/supabase/server';
import type { SequenceStep } from '@/lib/types';
import { isCategoria, type CategoriaKey } from '@/lib/categories';
import { SequencesListClient, type SequenceListItem } from './SequencesListClient';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  nome: string;
  categoria: string;
  steps: SequenceStep[] | null;
  atualizado_em: string;
};

export default async function SequenciasPage() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('sequences')
    .select('id,nome,categoria,steps,atualizado_em')
    .order('nome', { ascending: true });

  const rows = (data ?? []) as Row[];
  const items: SequenceListItem[] = rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    categoria: (isCategoria(r.categoria) ? r.categoria : 'lives') as CategoriaKey,
    stepCount: Array.isArray(r.steps) ? r.steps.length : 0,
  }));

  // A missing table (migration not applied yet) surfaces as an error — show a hint
  // instead of a blank page so the user knows to run the migration.
  const tableMissing =
    Boolean(error) && /relation .*sequences.* does not exist|could not find the table/i.test(
      error?.message ?? '',
    );

  return <SequencesListClient items={items} loadError={error ? error.message : null} tableMissing={tableMissing} />;
}
