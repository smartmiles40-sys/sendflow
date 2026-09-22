// A REGRA do sistema: qual conector cada campanha pode usar.
//
// Decisão do Bruno em 22/09/2026, e é uma regra, não uma preferência:
//
//     DISPARO EM MASSA PARA CONTATOS SÓ SAI PELA API OFICIAL (Cloud API).
//
// O motivo é medido, não teórico. A Evolution é um chip lido por QR Code: mandar
// centenas de primeiras mensagens por ele é exatamente o padrão que a Meta descreve
// como "spam, automated, or bulk messaging", e foi o que derrubou os números dos SDRs
// com bloqueio de 24 h. A API oficial existe para isso e não pune por volume — pune
// por conteúdo ruim, que é o que a aprovação do template filtra antes.
//
// A contrapartida é que a Meta NÃO envia para grupo. Então o caminho é o inverso lá:
// grupo só pela Evolution.
//
// Esta validação roda em três lugares, de propósito:
//   • na tela, para o erro aparecer antes de a pessoa clicar em enviar;
//   • na API, para quem chama por fora não escapar;
//   • no banco (trigger da 0019), para quem escrever direto no Postgres também não.

import type { Campaign, Connection, WhatsAppTemplate } from '../types';

export interface ProblemaCanal {
  field: string;
  message: string;
}

export interface EntradaValidacao {
  alvo: 'grupos' | 'contatos';
  conexao: Pick<Connection, 'provider' | 'nome' | 'status'> | null;
  template: Pick<
    WhatsAppTemplate,
    'status' | 'variaveis_corpo' | 'variaveis_cabecalho' | 'cabecalho_tipo'
  > | null;
  /** O que a campanha preencheu: posição → texto. */
  variaveis: Record<string, string> | null | undefined;
  /** URL da mídia do cabeçalho, quando o template tem cabeçalho de imagem/vídeo/PDF. */
  cabecalhoUrl?: string | null;
  /** Nome do template escolhido, só para saber se foi escolhido algum. */
  templateNome?: string | null;
}

/** Quantas posições de 1..n o mapa preencheu com texto não vazio. */
function preenchidas(variaveis: Record<string, string> | null | undefined, ate: number): number {
  let total = 0;
  for (let pos = 1; pos <= ate; pos += 1) {
    if (String(variaveis?.[String(pos)] ?? '').trim()) total += 1;
  }
  return total;
}

/**
 * Devolve a lista de problemas. Vazia = pode disparar.
 *
 * As mensagens são escritas para quem opera a tela, não para quem escreveu o código:
 * dizem o que fazer, não o que está errado.
 */
export function validarCanal(entrada: EntradaValidacao): ProblemaCanal[] {
  const problemas: ProblemaCanal[] = [];
  const { alvo, conexao, template } = entrada;

  // ── Grupos: só Evolution ──
  if (alvo === 'grupos') {
    if (conexao?.provider === 'cloud') {
      problemas.push({
        field: 'connection_id',
        message:
          'A API oficial da Meta não envia para grupos. Escolha um número conectado por QR Code (Evolution) para campanhas de grupo.',
      });
    }
    return problemas;
  }

  // ── Contatos: só API oficial ──
  if (!conexao) {
    problemas.push({
      field: 'connection_id',
      message:
        'Escolha o número da API oficial que vai disparar. Disparo em massa para contatos não sai por chip.',
    });
    return problemas;
  }

  if (conexao.provider !== 'cloud') {
    problemas.push({
      field: 'connection_id',
      message: `"${conexao.nome}" é um chip conectado por QR Code, e disparo em massa por chip derruba o número (bloqueio de 24 h da Meta). Escolha um número da API oficial.`,
    });
    return problemas;
  }

  if (conexao.status !== 'conectada') {
    problemas.push({
      field: 'connection_id',
      message: `O número "${conexao.nome}" não está pronto para disparar. Confira a conexão em Conexões.`,
    });
  }

  if (!entrada.templateNome?.trim()) {
    problemas.push({
      field: 'template_nome',
      message:
        'Escolha um template aprovado. A primeira mensagem para quem nunca escreveu só pode ser um template — a Meta recusa texto livre.',
    });
    return problemas;
  }

  if (!template) {
    problemas.push({
      field: 'template_nome',
      message: 'Este template não está na lista sincronizada. Atualize os templates em Conexões.',
    });
    return problemas;
  }

  if (template.status !== 'APPROVED') {
    problemas.push({
      field: 'template_nome',
      message: `Este template está "${template.status}" na Meta e não pode ser enviado. Só templates APPROVED disparam.`,
    });
  }

  // Contagem de variáveis: errar aqui é o erro 132000, e ele só aparece com a campanha
  // JÁ EM VOO — a fila inteira falha uma a uma. Por isso a conferência é antes.
  const corpoFaltando = template.variaveis_corpo - preenchidas(entrada.variaveis, template.variaveis_corpo);
  if (corpoFaltando > 0) {
    problemas.push({
      field: 'template_variaveis',
      message:
        template.variaveis_corpo === 1
          ? 'Preencha a variável do template.'
          : `Preencha as ${template.variaveis_corpo} variáveis do template — faltam ${corpoFaltando}.`,
    });
  }

  const precisaMidia =
    template.cabecalho_tipo === 'IMAGE' ||
    template.cabecalho_tipo === 'VIDEO' ||
    template.cabecalho_tipo === 'DOCUMENT';
  if (precisaMidia && !entrada.cabecalhoUrl?.trim()) {
    problemas.push({
      field: 'template_cabecalho_url',
      message: 'Este template tem cabeçalho de mídia. Anexe o arquivo que vai no topo da mensagem.',
    });
  }

  return problemas;
}

/**
 * A mesma regra, do ponto de vista do motor: esta linha da fila pode sair por esta
 * conexão? Usada na drenagem, onde já não há tela para avisar ninguém.
 */
export function conectorCerto(
  destinoTipo: 'grupo' | 'contato',
  provider: Connection['provider'],
): boolean {
  return destinoTipo === 'grupo' ? provider === 'evolution' : provider === 'cloud';
}

/** Rótulo curto do conector, para a tela. */
export function nomeDoConector(provider: Connection['provider']): string {
  return provider === 'cloud' ? 'API oficial' : 'Chip (QR Code)';
}

/** A campanha é um disparo em massa (1-a-1 pela API oficial)? */
export function ehDisparoEmMassa(campanha: Pick<Campaign, 'alvo'>): boolean {
  return campanha.alvo === 'contatos';
}
