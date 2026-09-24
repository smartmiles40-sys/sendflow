import { InstagramClient } from './InstagramClient';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Instagram · SendFlow' };

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; conectado?: string; avisos?: string }>;
}) {
  const sp = await searchParams;
  return (
    <InstagramClient
      retorno={{ erro: sp.erro ?? null, conectado: sp.conectado ?? null, avisos: sp.avisos ?? null }}
    />
  );
}
