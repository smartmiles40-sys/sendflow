import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Apaga a DEFINIÇÃO do campo. Os valores já gravados nos contatos ficam (em
 * `contacts.campos`) — apagar dado de cliente sem querer não tem volta; a definição tem.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await createServerClient().from('contact_fields').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
