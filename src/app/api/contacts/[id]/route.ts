import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { emailValido, normalizarEmail, separarTags } from '@/lib/contatos';
import { normalizarTelefoneBR, telefoneValido } from '@/lib/whatsapp/jid';

export const dynamic = 'force-dynamic';

/** O contato + o histórico dele nos dois canais. É a "ficha" que a tela abre. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: contato, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contato) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });

  const [{ data: engajamento }, { data: emails }, { data: whats }, { data: listas }] =
    await Promise.all([
      supabase.from('vw_contato_engajamento').select('*').eq('contact_id', id).maybeSingle(),
      supabase
        .from('email_recipients')
        .select('id,status,enviado_em,primeiro_aberto_em,primeiro_clique_em,aberturas,cliques,email_campaigns(nome,assunto)')
        .eq('contact_id', id)
        .order('enviado_em', { ascending: false })
        .limit(20),
      supabase
        .from('campaign_recipients')
        .select('id,status,enviado_em,entregue_em,lido_em,respondido_em,campaigns(nome)')
        .eq('contact_id', id)
        .order('enviado_em', { ascending: false })
        .limit(20),
      supabase.from('list_members').select('list_id,lists(id,nome,cor)').eq('contact_id', id),
    ]);

  return NextResponse.json({
    contato,
    engajamento: engajamento ?? null,
    emails: emails ?? [],
    whatsapp: whats ?? [],
    listas: listas ?? [],
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readJson<Record<string, unknown>>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if ('nome' in body) patch.nome = String(body.nome ?? '').trim() || null;
  if ('empresa' in body) patch.empresa = String(body.empresa ?? '').trim() || null;
  if ('campos' in body && body.campos && typeof body.campos === 'object') patch.campos = body.campos;

  if ('email' in body) {
    const email = body.email ? normalizarEmail(String(body.email)) : '';
    if (email && !emailValido(email)) {
      return NextResponse.json({ errors: [{ field: 'email', message: 'E-mail inválido.' }] }, { status: 400 });
    }
    patch.email = email || null;
  }
  if ('telefone' in body) {
    const telefone = body.telefone ? normalizarTelefoneBR(String(body.telefone)) : '';
    if (telefone && !telefoneValido(telefone)) {
      return NextResponse.json({ errors: [{ field: 'telefone', message: 'Telefone inválido.' }] }, { status: 400 });
    }
    patch.telefone = telefone || null;
  }
  if ('tags' in body) {
    patch.tags = Array.isArray(body.tags)
      ? separarTags((body.tags as string[]).join(','))
      : separarTags(String(body.tags ?? ''));
  }

  /**
   * Reativar quem saiu é um caminho de mão única, e de propósito.
   *
   * Descadastro, bounce e marcação de spam não são estados que a equipe desfaz por
   * conveniência — o primeiro é vontade da pessoa e os outros dois são veredicto do
   * provedor. Voltar a mandar para eles é exatamente como se queima a reputação de um
   * domínio. Só permitimos o sentido contrário: marcar alguém como descadastrado.
   */
  if ('status_email' in body) {
    if (body.status_email !== 'descadastrado' && body.status_email !== 'ativo') {
      return NextResponse.json({ error: 'Status de e-mail inválido.' }, { status: 400 });
    }
    if (body.status_email === 'ativo') {
      const { data: atual } = await createServerClient()
        .from('contacts')
        .select('status_email')
        .eq('id', id)
        .maybeSingle();
      if (atual && (atual.status_email === 'bounce' || atual.status_email === 'spam')) {
        return NextResponse.json(
          {
            error:
              'Este e-mail foi recusado pelo provedor (bounce ou spam) e não pode ser reativado. Cadastre um endereço novo.',
          },
          { status: 409 },
        );
      }
    }
    patch.status_email = body.status_email;
    patch.descadastrado_em = body.status_email === 'descadastrado' ? new Date().toISOString() : null;
  }
  if ('status_whatsapp' in body) {
    if (!['ativo', 'descadastrado', 'invalido'].includes(String(body.status_whatsapp))) {
      return NextResponse.json({ error: 'Status de WhatsApp inválido.' }, { status: 400 });
    }
    patch.status_whatsapp = body.status_whatsapp;
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('contacts')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Já existe outro contato com esse e-mail ou telefone.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });

  if (Array.isArray(body.list_ids)) {
    // Substitui o conjunto de listas: apaga as que saíram, insere as que entraram.
    await supabase.from('list_members').delete().eq('contact_id', id);
    if (body.list_ids.length) {
      await supabase
        .from('list_members')
        .insert((body.list_ids as string[]).map((list_id) => ({ list_id, contact_id: id })));
    }
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
