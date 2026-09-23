import { AutomacoesClient } from './AutomacoesClient';
import { ABAS, type Aba } from './abas';

export const dynamic = 'force-dynamic';

export default async function AutomacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pedida = typeof sp.aba === 'string' ? sp.aba : '';
  const aba = (ABAS.some((a) => a.id === pedida) ? pedida : 'fluxos') as Aba;
  return <AutomacoesClient abaInicial={aba} />;
}
