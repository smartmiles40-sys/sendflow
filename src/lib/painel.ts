import type { SupabaseClient } from '@supabase/supabase-js';
import { diaSP, diasAtras, taxa } from './kpis';
import type { CampaignKpi, DestinoKpi, EmailKpi, KpiDiario } from './types';

/**
 * Carrega tudo que o painel mostra.
 *
 * Fica numa função compartilhada porque DOIS caminhos precisam do mesmo resultado:
 * a página (que renderiza no servidor, para a tela já chegar preenchida) e a rota
 * `/api/kpis` (que o cliente chama ao trocar o período). Duplicar isso seria duplicar
 * a definição das taxas — exatamente como um painel passa a mostrar dois números
 * diferentes para a mesma pergunta.
 */

export interface ResumoCanal {
  enviados: number;
  entregues: number;
  engajados: number;
  acoes: number;
  falhas: number;
  taxa_entrega: number | null;
  taxa_engajamento: number | null;
  taxa_acao: number | null;
}

export interface DadosPainel {
  resumo: { whatsapp: ResumoCanal; email: ResumoCanal; dias: number; desde: string };
  serie: KpiDiario[];
  campanhas: CampaignKpi[];
  emails: EmailKpi[];
  destinos: DestinoKpi[];
  conexoes: { id: string; nome: string; status: string; numero: string | null; ultimo_erro: string | null }[];
  fila: { whatsapp: number; email: number };
}

export async function carregarPainel(
  supabase: SupabaseClient,
  dias: number,
): Promise<DadosPainel> {
  const janela = Math.min(365, Math.max(1, dias));
  const desde = diaSP(diasAtras(new Date(), janela - 1));

  const [serieRes, campanhasRes, emailsRes, destinosRes, conexoesRes, filaWhatsRes, filaEmailRes] =
    await Promise.all([
      supabase.from('vw_kpis_diarios').select('*').gte('dia', desde).order('dia', { ascending: true }),
      supabase
        .from('vw_campaign_kpis')
        .select('*')
        .not('ultimo_envio_em', 'is', null)
        .order('ultimo_envio_em', { ascending: false })
        .limit(15),
      supabase
        .from('vw_email_kpis')
        .select('*')
        .not('enviado_em', 'is', null)
        .order('enviado_em', { ascending: false })
        .limit(15),
      supabase
        .from('vw_destino_kpis')
        .select('*')
        .gt('recebidas', 0)
        .order('recebidas', { ascending: false })
        .limit(20),
      supabase.from('connections').select('id,nome,status,numero,ultimo_erro'),
      supabase
        .from('campaign_recipients')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendente', 'enviando']),
      supabase
        .from('email_recipients')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendente', 'enviando']),
    ]);

  const serie = (serieRes.data ?? []) as KpiDiario[];

  return {
    // O resumo é a SOMA da mesma série que o gráfico desenha. É o que garante que o
    // número grande no topo e a linha logo abaixo nunca se contradigam.
    resumo: {
      whatsapp: somar(serie.filter((s) => s.canal === 'whatsapp')),
      email: somar(serie.filter((s) => s.canal === 'email')),
      dias: janela,
      desde,
    },
    serie,
    campanhas: (campanhasRes.data ?? []) as CampaignKpi[],
    emails: (emailsRes.data ?? []) as EmailKpi[],
    destinos: (destinosRes.data ?? []) as DestinoKpi[],
    conexoes: (conexoesRes.data ?? []) as DadosPainel['conexoes'],
    fila: { whatsapp: filaWhatsRes.count ?? 0, email: filaEmailRes.count ?? 0 },
  };
}

function somar(linhas: KpiDiario[]): ResumoCanal {
  const total = linhas.reduce(
    (acc, l) => ({
      enviados: acc.enviados + Number(l.enviados ?? 0),
      entregues: acc.entregues + Number(l.entregues ?? 0),
      engajados: acc.engajados + Number(l.engajados ?? 0),
      acoes: acc.acoes + Number(l.acoes ?? 0),
      falhas: acc.falhas + Number(l.falhas ?? 0),
    }),
    { enviados: 0, entregues: 0, engajados: 0, acoes: 0, falhas: 0 },
  );
  return {
    ...total,
    taxa_entrega: taxa(total.entregues, total.enviados),
    taxa_engajamento: taxa(total.engajados, total.entregues),
    taxa_acao: taxa(total.acoes, total.entregues),
  };
}
