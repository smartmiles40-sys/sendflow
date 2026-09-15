import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Webhook do Resend: entrega, bounce e denúncia de spam.
 *
 * Abertura e clique NÃO vêm por aqui de propósito — o Resend só os reporta se o
 * rastreamento dele estiver ligado, e aí teríamos a mesma abertura contada duas vezes
 * (a nossa, pelo pixel, e a dele). Uma fonte só por métrica.
 *
 * O que só o provedor sabe, e por isso vale este endpoint:
 *   • ENTREGUE de verdade (o servidor do destinatário aceitou), contra o nosso
 *     "mandamos e não deu erro";
 *   • BOUNCE (a caixa não existe ou recusou);
 *   • RECLAMAÇÃO DE SPAM (a pessoa apertou "é spam") — o evento mais importante do
 *     e-mail marketing, porque é o que destrói reputação de domínio.
 * Os dois últimos derrubam o contato automaticamente, em `registrar_falha_email`.
 */

/** `email.bounced` → `bounce`. O que não interessa devolve null e é ignorado. */
function traduzirEvento(tipo: string): 'entregue' | 'bounce' | 'spam' | null {
  switch (tipo) {
    case 'email.delivered':
      return 'entregue';
    case 'email.bounced':
      return 'bounce';
    case 'email.complained':
      return 'spam';
    default:
      // sent, delivery_delayed, opened, clicked: ou já sabemos, ou medimos por conta própria.
      return null;
  }
}

/**
 * Confere a assinatura Svix (o serviço de webhooks que o Resend usa).
 *
 * Assina-se `id.timestamp.corpo` com o segredo, e o cabeçalho traz uma lista de
 * versões (`v1,<base64> v1,<outra>`) porque durante a troca de segredo as duas valem.
 * Sem esta checagem, qualquer um manda um POST marcando a base inteira como bounce.
 */
function assinaturaSvixConfere(
  corpo: string,
  headers: Headers,
  segredoBruto: string,
): boolean {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const assinaturas = headers.get('svix-signature');
  if (!id || !timestamp || !assinaturas) return false;

  // Janela de 5 minutos: impede que um POST legítimo capturado seja reenviado depois.
  const idadeSeg = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(idadeSeg) || idadeSeg > 300) return false;

  const segredo = Buffer.from(segredoBruto.replace(/^whsec_/, ''), 'base64');
  const esperada = createHmac('sha256', segredo)
    .update(`${id}.${timestamp}.${corpo}`)
    .digest('base64');

  return assinaturas.split(' ').some((parte) => {
    const valor = parte.includes(',') ? parte.split(',')[1] : parte;
    const a = Buffer.from(valor);
    const b = Buffer.from(esperada);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function POST(req: Request) {
  // O corpo precisa ser lido como TEXTO: a assinatura é sobre os bytes exatos que
  // chegaram. Fazer `req.json()` e re-serializar muda espaços e ordem, e a conferência
  // falharia sempre.
  const corpo = await req.text();

  const segredo = (process.env.RESEND_WEBHOOK_SECRET ?? '').trim();
  if (segredo) {
    if (!assinaturaSvixConfere(corpo, req.headers, segredo)) {
      return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 });
    }
  }

  let payload: { type?: string; data?: { email_id?: string; reason?: string; bounce?: { message?: string } } };
  try {
    payload = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ ok: true, ignorado: 'corpo inválido' });
  }

  const tipo = traduzirEvento(String(payload.type ?? ''));
  const messageId = payload.data?.email_id;
  if (!tipo || !messageId) return NextResponse.json({ ok: true, ignorado: payload.type ?? 'sem tipo' });

  try {
    const supabase = createServerClient();
    if (tipo === 'entregue') {
      await supabase.rpc('registrar_entrega_email', { p_message_id: messageId });
    } else {
      await supabase.rpc('registrar_falha_email', {
        p_message_id: messageId,
        p_tipo: tipo,
        p_detalhe: payload.data?.bounce?.message ?? payload.data?.reason ?? null,
      });
    }
  } catch (e) {
    // Mesma regra do webhook da Evolution: erro nosso não vira erro para o provedor,
    // senão ele entra em ciclo de retentativa em cima de um endpoint que já está mal.
    console.error('[webhook resend] falhou:', e);
  }

  return NextResponse.json({ ok: true });
}
