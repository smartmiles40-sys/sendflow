// O vigia do motor.
//
// O problema que isto resolve já aconteceu duas vezes em outro sistema do time: o
// agendador morreu calado e ninguém descobriu por dias, porque a tela continuava
// mostrando "enviando" e o painel mostrando zero — que é indistinguível de "ninguém
// leu ainda". Falha silenciosa é a pior falha de um disparador.
//
// O que ele vigia, e nada além disso (um alerta que dispara à toa é desligado em uma
// semana e vira ruído):
//
//   • número caído — a conexão foi para 'erro', e nada mais vai sair por ela;
//   • qualidade RED na Meta — o teto diário despenca e a punição vem em seguida;
//   • campanha que terminou sem nenhum envio;
//   • fila parada — há mensagens pendentes e nada saiu no último ciclo.
//
// O destinatário é `app_settings.envio.alerta_email`. Em branco = vigia desligado, sem
// erro e sem log: nem todo mundo quer e-mail de sistema.

import type { SupabaseClient } from '@supabase/supabase-js';
import { enviarEmail, provedorAtivo } from '../email/provider';
import { urlPublica } from '../url';

/** Espaçamento mínimo entre dois alertas do mesmo motivo. */
const SILENCIO_MIN = 60;

export interface Alerta {
  motivo: string;
  titulo: string;
  detalhe: string;
}

/**
 * Junta o que está quebrado agora. Só leitura — não decide mandar nada.
 * Exportada para teste e para a tela poder mostrar o mesmo diagnóstico.
 */
export async function coletarAlertas(
  supabase: SupabaseClient,
  pendentes: number,
  enviadasNoTick: number,
): Promise<Alerta[]> {
  const alertas: Alerta[] = [];

  const { data: conexoes } = await supabase
    .from('connections')
    .select('nome,provider,status,qualidade,ultimo_erro')
    .eq('ativo', true);

  for (const c of (conexoes ?? []) as {
    nome: string;
    provider: string;
    status: string;
    qualidade: string | null;
    ultimo_erro: string | null;
  }[]) {
    if (c.status === 'erro') {
      alertas.push({
        motivo: `conexao-erro:${c.nome}`,
        titulo: `O número "${c.nome}" caiu`,
        detalhe: c.ultimo_erro ?? 'Sem detalhe. Abra Conexões para reconectar.',
      });
    }
    if (c.provider === 'cloud' && c.qualidade === 'RED') {
      alertas.push({
        motivo: `qualidade-red:${c.nome}`,
        titulo: `A Meta rebaixou a qualidade do número "${c.nome}" para VERMELHO`,
        detalhe:
          'O teto diário de mensagens cai junto, e a próxima etapa é a restrição do número. ' +
          'Pare as campanhas de marketing, revise a lista e confira quantas pessoas responderam "PARAR".',
      });
    }
  }

  // Fila parada: há o que enviar e nada saiu neste ciclo. Um tick pode terminar sem
  // envio por motivo legítimo (janela de horário, intervalo anti-bloqueio), então este
  // alerta só vale junto com o silêncio de uma hora — se o motivo era legítimo, o
  // próximo tick envia e o alerta não chega a ser repetido.
  if (pendentes > 0 && enviadasNoTick === 0) {
    alertas.push({
      motivo: 'fila-parada',
      titulo: `${pendentes} mensagens na fila e nenhuma saiu`,
      detalhe:
        'O motor rodou e não conseguiu enviar nada. Confira em Conexões se algum número caiu ' +
        'e, em Configurações, se a janela de horário está fechada.',
    });
  }

  const { data: falhadas } = await supabase
    .from('campaigns')
    .select('nome,resultado')
    .eq('status', 'erro')
    .gte('atualizado_em', new Date(Date.now() - SILENCIO_MIN * 60_000).toISOString())
    .limit(5);

  for (const c of (falhadas ?? []) as { nome: string; resultado: { erro?: string } | null }[]) {
    alertas.push({
      motivo: `campanha-erro:${c.nome}`,
      titulo: `A campanha "${c.nome}" terminou sem enviar nada`,
      detalhe: c.resultado?.erro ?? 'Abra a campanha para ver o motivo de cada destinatário.',
    });
  }

  return alertas;
}

/**
 * Decide quais alertas ainda podem ser mandados, com base em quando cada motivo foi
 * avisado pela última vez.
 *
 * O estado mora em `app_settings.alertas` (motivo → ISO do último envio) em vez de na
 * memória do processo, pela mesma razão de sempre: cada tick é um processo novo, e um
 * controle em memória mandaria o mesmo e-mail de minuto em minuto.
 */
export function filtrarPorSilencio(
  alertas: Alerta[],
  jaAvisados: Record<string, string>,
  agora: Date,
): Alerta[] {
  const corte = agora.getTime() - SILENCIO_MIN * 60_000;
  return alertas.filter((a) => {
    const quando = new Date(jaAvisados[a.motivo] ?? 0).getTime();
    return !Number.isFinite(quando) || quando < corte;
  });
}

/** Roda o vigia. Devolve quantos alertas foram enviados. Nunca lança. */
export async function avisarSePreciso(
  supabase: SupabaseClient,
  pendentes: number,
  enviadasNoTick: number,
  agora: Date = new Date(),
): Promise<number> {
  try {
    const { data: config } = await supabase
      .from('app_settings')
      .select('valor')
      .eq('chave', 'envio')
      .maybeSingle();
    const destino = String((config?.valor as { alerta_email?: string })?.alerta_email ?? '').trim();
    if (!destino || !(await provedorAtivo())) return 0;

    const alertas = await coletarAlertas(supabase, pendentes, enviadasNoTick);
    if (!alertas.length) return 0;

    const { data: estado } = await supabase
      .from('app_settings')
      .select('valor')
      .eq('chave', 'alertas')
      .maybeSingle();
    const jaAvisados = ((estado?.valor as Record<string, string>) ?? {}) as Record<string, string>;

    const mandar = filtrarPorSilencio(alertas, jaAvisados, agora);
    if (!mandar.length) return 0;

    const { data: cfgRemetente } = await supabase
      .from('app_settings')
      .select('valor')
      .eq('chave', 'email_remetente')
      .maybeSingle();
    const remetente = (cfgRemetente?.valor ?? {}) as { nome?: string; email?: string };
    // Sem remetente verificado o envio seria recusado pelo provedor; melhor não tentar
    // do que gastar tentativa e sujar o log com uma falha que não é do motor.
    if (!remetente.email) return 0;
    const base = urlPublica();
    const corpo = mandar
      .map((a) => `<p><strong>${escapar(a.titulo)}</strong><br>${escapar(a.detalhe)}</p>`)
      .join('\n');

    await enviarEmail({
      para: destino,
      de: remetente.email,
      deNome: remetente.nome || 'SendFlow',
      assunto:
        mandar.length === 1 ? `SendFlow: ${mandar[0].titulo}` : `SendFlow: ${mandar.length} avisos do motor`,
      html: `${corpo}\n<p><a href="${base}/painel">Abrir o SendFlow</a></p>`,
      texto: mandar.map((a) => `${a.titulo}\n${a.detalhe}`).join('\n\n'),
    });

    const novoEstado = { ...jaAvisados };
    for (const a of mandar) novoEstado[a.motivo] = agora.toISOString();
    await supabase
      .from('app_settings')
      .upsert({ chave: 'alertas', valor: novoEstado }, { onConflict: 'chave' });

    return mandar.length;
  } catch (e) {
    // O vigia nunca pode derrubar o motor: o trabalho dele é secundário ao envio.
    console.error('[alerta] falhou:', e);
    return 0;
  }
}

function escapar(valor: string): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
