import { emailValido, normalizarEmail } from '../contatos';
import type { ValidationError } from '../validation';

export interface EntradaEmailCampanha {
  nome: string;
  assunto: string;
  assunto_b: string | null;
  preheader: string | null;
  remetente_nome: string;
  remetente_email: string;
  responder_para: string | null;
  html: string;
  texto: string | null;
  list_ids: string[];
  /** Segmento salvo (0023) — alternativa às listas como público. */
  segment_id: string | null;
  tags: string[];
  enviar_em: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza e valida o corpo de uma campanha de e-mail.
 *
 * `rascunho` é deliberadamente permissivo: a pessoa precisa poder salvar um esboço sem
 * ter decidido público nem assunto. A validação dura só entra quando a campanha vai
 * de fato para a fila — que é o momento em que um erro fica caro, porque e-mail
 * enviado não volta.
 */
export function parseEmailCampanha(
  body: Record<string, unknown>,
  opcoes: { rascunho: boolean; agora?: Date },
): { valor: EntradaEmailCampanha; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const agora = opcoes.agora ?? new Date();

  const nome = String(body.nome ?? '').trim();
  if (!nome) errors.push({ field: 'nome', message: 'Dê um nome à campanha.' });

  const assunto = String(body.assunto ?? '').trim();
  const remetenteEmail = normalizarEmail(String(body.remetente_email ?? ''));
  const remetenteNome = String(body.remetente_nome ?? '').trim();
  const html = String(body.html ?? '');
  const listIds = Array.isArray(body.list_ids) ? (body.list_ids as string[]).filter(Boolean) : [];
  const segmentoBruto = String(body.segment_id ?? '').trim();
  const segmentId = UUID.test(segmentoBruto) ? segmentoBruto : null;
  if (segmentoBruto && !segmentId) errors.push({ field: 'segment_id', message: 'Segmento inválido.' });

  if (!opcoes.rascunho) {
    if (!assunto) errors.push({ field: 'assunto', message: 'Escreva o assunto do e-mail.' });
    if (assunto.length > 200) {
      errors.push({ field: 'assunto', message: 'Assunto longo demais (máximo 200 caracteres).' });
    }
    if (!remetenteNome) {
      errors.push({ field: 'remetente_nome', message: 'Informe o nome que aparece como remetente.' });
    }
    if (!emailValido(remetenteEmail)) {
      errors.push({ field: 'remetente_email', message: 'E-mail do remetente inválido.' });
    }
    if (!html.trim()) errors.push({ field: 'html', message: 'O e-mail está vazio.' });
    if (!listIds.length && !segmentId) {
      errors.push({ field: 'list_ids', message: 'Escolha ao menos uma lista ou um segmento para receber.' });
    }
  }

  const responderPara = body.responder_para ? normalizarEmail(String(body.responder_para)) : '';
  if (responderPara && !emailValido(responderPara)) {
    errors.push({ field: 'responder_para', message: 'E-mail de resposta inválido.' });
  }

  let enviarEm: string | null = null;
  if (body.enviar_em) {
    const t = new Date(String(body.enviar_em)).getTime();
    if (Number.isNaN(t)) {
      errors.push({ field: 'enviar_em', message: 'Data inválida.' });
    } else {
      // Tolerância de 1 minuto: "enviar agora" chega aqui como o horário do clique, e
      // o ida-e-volta da requisição já o deixou alguns segundos no passado.
      if (!opcoes.rascunho && t < agora.getTime() - 60_000) {
        errors.push({ field: 'enviar_em', message: 'A data precisa ser no futuro.' });
      }
      enviarEm = new Date(t).toISOString();
    }
  }

  const assuntoB = String(body.assunto_b ?? '').trim();
  if (assuntoB && assuntoB === assunto) {
    errors.push({
      field: 'assunto_b',
      message: 'O assunto B precisa ser diferente do A — senão não há o que comparar.',
    });
  }

  return {
    valor: {
      nome,
      assunto,
      assunto_b: assuntoB || null,
      preheader: String(body.preheader ?? '').trim() || null,
      remetente_nome: remetenteNome,
      remetente_email: remetenteEmail,
      responder_para: responderPara || null,
      html,
      texto: String(body.texto ?? '').trim() || null,
      list_ids: listIds,
      segment_id: segmentId,
      tags: Array.isArray(body.tags) ? (body.tags as string[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
      enviar_em: enviarEm,
    },
    errors,
  };
}
