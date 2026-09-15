import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { rodarWhatsApp } from '@/lib/dispatch/whatsapp-worker';
import { rodarEmail } from '@/lib/dispatch/email-worker';
import { Orcamento } from '@/lib/dispatch/ritmo';
import { refillSePreciso } from '@/lib/dispatch/refill-periodico';

export const dynamic = 'force-dynamic';

/**
 * Teto de tempo desta função na hospedagem. 60 s é o limite do plano padrão da Vercel;
 * em plano com mais folga dá para subir junto com ORCAMENTO_MS e mandar mais por ciclo.
 */
export const maxDuration = 60;

/**
 * Quanto o motor pode trabalhar antes de devolver a vez. Fica abaixo de `maxDuration`
 * de propósito: a diferença é a margem para fechar as campanhas e responder. Ser
 * cortado no meio pela hospedagem não corrompe nada (a fila é o estado), mas deixa
 * linhas em 'enviando' que só voltam depois de 15 minutos.
 */
const ORCAMENTO_MS = 45_000;

/**
 * O relógio do sistema. Chamado de minuto em minuto por um agendador externo
 * (Vercel Cron, ou um Schedule Trigger do n8n apontando para cá).
 *
 * É idempotente e interrompível: chamar duas vezes seguidas, ou não chamar por três
 * horas, não duplica nem perde mensagem. Todo o estado está na fila, no banco.
 *
 * `restante > 0` na resposta significa que ainda há fila. Um agendador esperto pode
 * chamar de novo na hora em vez de esperar o próximo minuto.
 */
async function executar(req: Request) {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (secret) {
    const header = req.headers.get('x-cron-secret') ?? '';
    const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const query = new URL(req.url).searchParams.get('secret') ?? '';
    if (header !== secret && bearer !== secret && query !== secret) {
      return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
    }
  }

  const canal = (new URL(req.url).searchParams.get('canal') ?? 'todos').toLowerCase();
  const inicio = Date.now();
  const orcamento = new Orcamento(ORCAMENTO_MS, inicio);
  const supabase = createServerClient();
  const agora = new Date();

  // WhatsApp primeiro: é o canal com restrição de ritmo, então é ele que precisa da
  // maior fatia do orçamento. O e-mail aproveita o que sobrar e, sendo rápido, costuma
  // esvaziar a fila inteira no resto do tempo.
  const whatsapp =
    canal === 'email'
      ? null
      : await rodarWhatsApp(supabase, orcamento, agora).catch((e) => {
          console.error('[tick] whatsapp falhou:', e);
          return null;
        });

  const email =
    canal === 'whatsapp'
      ? null
      : await rodarEmail(supabase, orcamento, agora).catch((e) => {
          console.error('[tick] email falhou:', e);
          return null;
        });

  // Materializa as próximas ocorrências das campanhas recorrentes. Vem por último
  // porque é barato e não urgente — o que importa é não depender de um agendador
  // separado, que já morreu calado uma vez.
  const recorrentes = await refillSePreciso(supabase, agora).catch((e) => {
    console.error('[tick] refill falhou:', e);
    return null;
  });

  const restante = (whatsapp?.pendentes ?? 0) + (email?.pendentes ?? 0);

  return NextResponse.json({
    ok: true,
    duracao_ms: Date.now() - inicio,
    restante,
    whatsapp,
    email,
    recorrentes,
  });
}

export async function POST(req: Request) {
  return executar(req);
}

/**
 * O Vercel Cron chama por GET, então a rota aceita os dois verbos.
 * A proteção é a mesma: sem `CRON_SECRET` correto, ninguém aciona o motor de fora.
 */
export async function GET(req: Request) {
  return executar(req);
}
