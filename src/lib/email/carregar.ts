import { createServerClient } from '../supabase/server';
import { provedorAtivo } from './provider';
import type { DadosEditor } from '@/components/EmailEditor';
import type { EmailCampaign, EmailTemplate, Lista } from '../types';

/**
 * Carrega o que o editor de e-mail precisa: listas com a contagem, modelos prontos e
 * o remetente padrão das configurações.
 *
 * O remetente padrão evita o erro mais comum de quem monta a segunda campanha: digitar
 * um endereço diferente do domínio verificado e só descobrir no bounce.
 */
export async function carregarDadosEditor(campanhaId?: string): Promise<DadosEditor> {
  const supabase = createServerClient();

  const [{ data: listas }, { data: modelos }, { data: cfg }, campanhaRes] = await Promise.all([
    supabase.from('lists').select('*').order('nome', { ascending: true }),
    supabase.from('email_templates').select('*').order('criado_em', { ascending: true }),
    supabase.from('app_settings').select('valor').eq('chave', 'email_remetente').maybeSingle(),
    campanhaId
      ? supabase.from('email_campaigns').select('*').eq('id', campanhaId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const comTotal = await Promise.all(
    ((listas ?? []) as Lista[]).map(async (l) => {
      const { count } = await supabase
        .from('list_members')
        .select('contact_id', { count: 'exact', head: true })
        .eq('list_id', l.id);
      return { ...l, total: count ?? 0 };
    }),
  );

  const remetente = (cfg?.valor ?? {}) as Record<string, string>;

  return {
    campanha: (campanhaRes.data as EmailCampaign | null) ?? null,
    listas: comTotal,
    modelos: (modelos ?? []) as EmailTemplate[],
    remetentePadrao: {
      nome: remetente.nome ?? '',
      email: remetente.email ?? '',
      responder_para: remetente.responder_para ?? '',
    },
    provedor: await provedorAtivo(),
  };
}
