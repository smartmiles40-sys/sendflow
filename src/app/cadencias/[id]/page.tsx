import { CadenciaCanvas } from './CadenciaCanvas';

export const dynamic = 'force-dynamic';

export default async function CadenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CadenciaCanvas id={id} />;
}
