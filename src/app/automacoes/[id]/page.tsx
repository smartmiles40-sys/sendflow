import { EditorFluxo } from './EditorFluxo';

export const dynamic = 'force-dynamic';

export default async function FluxoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorFluxo id={id} />;
}
