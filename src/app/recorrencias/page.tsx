import { createServerClient } from '@/lib/supabase/server';
import { refillTodas } from '@/lib/recorrencia-refill';
import { isCategoria, type CategoriaKey } from '@/lib/categories';
import type { Audience, Recorrencia } from '@/lib/types';
import { RecorrenciasClient, type RecorrenciaItem } from './RecorrenciasClient';

export const dynamic = 'force-dynamic';

function publicoLabel(r: Recorrencia, audiences: Audience[]): string {
  if (r.audience_id) {
    const a = audiences.find((x) => x.id === r.audience_id);
    return a ? `Público: ${a.nome}` : 'Público salvo (removido)';
  }
  if (r.group_ids?.length) {
    return `${r.group_ids.length} grupo${r.group_ids.length === 1 ? '' : 's'} selecionado${
      r.group_ids.length === 1 ? '' : 's'
    }`;
  }
  return 'Todos os grupos ativos';
}

export default async function RecorrenciasPage() {
  const supabase = createServerClient();

  // Abrir a tela também reabastece o horizonte: mesmo que o cron diário falhe,
  // o uso normal do painel mantém as próximas semanas agendadas.
  await refillTodas(supabase).catch(() => null);

  const { data, error } = await supabase
    .from('recorrencias')
    .select('*')
    .order('criado_em', { ascending: true });

  const rows = ((data ?? []) as Recorrencia[]).map((r) => ({
    ...r,
    categoria: (isCategoria(r.categoria) ? r.categoria : 'comunidade') as CategoriaKey,
  }));

  const [{ data: audData }, { data: campData }] = await Promise.all([
    supabase.from('audiences').select('*'),
    rows.length
      ? supabase
          .from('campaigns')
          .select('recorrencia_id,enviar_em')
          .in('recorrencia_id', rows.map((r) => r.id))
          .eq('status', 'agendada')
          .gt('enviar_em', new Date().toISOString())
          .order('enviar_em', { ascending: true })
      : Promise.resolve({ data: [] as { recorrencia_id: string; enviar_em: string }[] }),
  ]);

  const audiences = (audData ?? []) as Audience[];
  const proximasPorRec = new Map<string, string[]>();
  for (const c of (campData ?? []) as { recorrencia_id: string; enviar_em: string }[]) {
    const list = proximasPorRec.get(c.recorrencia_id) ?? [];
    if (list.length < 3) list.push(c.enviar_em);
    proximasPorRec.set(c.recorrencia_id, list);
  }

  const items: RecorrenciaItem[] = rows.map((r) => ({
    ...r,
    publicoLabel: publicoLabel(r, audiences),
    proximas: proximasPorRec.get(r.id) ?? [],
  }));

  // Migration ainda não aplicada: mostra a dica em vez de uma tela vazia.
  const tableMissing =
    Boolean(error) &&
    /relation .*recorrencias.* does not exist|could not find the table/i.test(error?.message ?? '');

  return (
    <RecorrenciasClient
      initial={items}
      loadError={error ? error.message : null}
      tableMissing={tableMissing}
    />
  );
}
