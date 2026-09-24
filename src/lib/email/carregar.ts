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

  // Segmentos com o total de AGORA — o número que a pessoa vê ao escolher o público.
  const { data: segs } = await supabase.from('segments').select('id,nome,regras').order('nome', { ascending: true });
  const segmentos = await Promise.all(
    ((segs ?? []) as { id: string; nome: string; regras: unknown }[]).map(async (s) => {
      const { data: r } = await supabase.rpc('sf_filtrar_contatos', { p_regras: s.regras, p_limite: 1, p_offset: 0 });
      const linha = ((r ?? []) as { total: number }[])[0];
      return { id: s.id, nome: s.nome, total: linha ? Number(linha.total) : 0 };
    }),
  );

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
    segmentos,
    modelos: (modelos ?? []) as EmailTemplate[],
    remetentePadrao: {
      nome: remetente.nome ?? '',
      email: remetente.email ?? '',
      responder_para: remetente.responder_para ?? '',
    },
    provedor: await provedorAtivo(),
  };
}
