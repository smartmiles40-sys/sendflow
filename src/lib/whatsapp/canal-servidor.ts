// A REGRA do canal aplicada do lado do servidor.
//
// `canal.ts` é puro e não sabe ler banco. Este arquivo é a ponte: busca a conexão e o
// template e entrega a `validarCanal` o que ela precisa. Fica separado para a regra
// continuar testável sem subir Supabase.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Connection, WhatsAppTemplate } from '../types';
import { validarCanal, type ProblemaCanal } from './canal';

export interface PedidoDeCanal {
  alvo: 'grupos' | 'contatos';
  connectionId: string | null;
  templateNome?: string | null;
  templateIdioma?: string | null;
  variaveis?: Record<string, string> | null;
  cabecalhoUrl?: string | null;
}

/**
 * Confere se esta campanha pode ser disparada por este canal.
 *
 * Devolve a lista de problemas prontos para virar `errors` na resposta HTTP — vazia
 * quando está tudo certo. É chamada no POST e no PATCH de campanha, antes de gravar,
 * para o erro chegar como um campo destacado na tela em vez de uma exceção do Postgres
 * vinda do trigger da 0019.
 */
export async function validarCanalNoServidor(
  supabase: SupabaseClient,
  pedido: PedidoDeCanal,
): Promise<ProblemaCanal[]> {
  let conexao: Connection | null = null;
  if (pedido.connectionId) {
    const { data } = await supabase
      .from('connections')
      .select('id,nome,provider,status')
      .eq('id', pedido.connectionId)
      .maybeSingle();
    conexao = (data as Connection | null) ?? null;
    if (!conexao) {
      return [{ field: 'connection_id', message: 'O número escolhido não existe mais.' }];
    }
  }

  let template: WhatsAppTemplate | null = null;
  if (pedido.alvo === 'contatos' && pedido.templateNome && pedido.connectionId) {
    const { data } = await supabase
      .from('whatsapp_templates')
      .select('status,variaveis_corpo,variaveis_cabecalho,cabecalho_tipo')
      .eq('connection_id', pedido.connectionId)
      .eq('nome', pedido.templateNome)
      .eq('idioma', pedido.templateIdioma || 'pt_BR')
      .maybeSingle();
    template = (data as WhatsAppTemplate | null) ?? null;
  }

  return validarCanal({
    alvo: pedido.alvo,
    conexao,
    template,
    variaveis: pedido.variaveis,
    cabecalhoUrl: pedido.cabecalhoUrl,
    templateNome: pedido.templateNome,
  });
}

/**
 * Lê o mapa de variáveis vindo do corpo da requisição.
 *
 * Só posição numérica e só texto: o campo é jsonb livre no banco, e aceitar objeto
 * aninhado aqui viraria um parâmetro `[object Object]` chegando na Meta.
 */
export function lerVariaveis(bruto: unknown): Record<string, string> | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    const pos = Number(chave);
    if (!Number.isInteger(pos) || pos < 1 || pos > 50) continue;
    if (valor === null || valor === undefined) continue;
    if (typeof valor === 'object') continue;
    saida[String(pos)] = String(valor);
  }
  return Object.keys(saida).length ? saida : null;
}
