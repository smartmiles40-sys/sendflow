// Validação da configuração de cada tipo de gatilho — usada na criação e na edição.

import type { GatilhoConfig, TipoGatilho } from './tipos';
import { normalizarTexto } from './montar';
import { novoToken } from './servidor';

/**
 * Confere e limpa a configuração de um gatilho.
 * Devolve a frase do erro, ou a config pronta para gravar.
 */
export function limparConfig(tipo: TipoGatilho, bruta: unknown): { config: GatilhoConfig } | { erro: string } {
  const c = (bruta ?? {}) as GatilhoConfig;
  switch (tipo) {
    case 'palavra_chave': {
      const palavras = [...new Set((c.palavras ?? []).map((p) => String(p).trim()).filter(Boolean))].slice(0, 50);
      if (!palavras.length) return { erro: 'Escreva pelo menos uma palavra-chave.' };
      const modo = c.modo === 'exata' || c.modo === 'comeca' ? c.modo : 'contem';
      return { config: { palavras, modo } };
    }
    case 'link_ref': {
      const codigo = normalizarTexto(String(c.codigo ?? '')).replace(/\s+/g, '-').slice(0, 40);
      if (!/^[a-z0-9_-]{2,40}$/.test(codigo)) return { erro: 'O código do link usa letras, números e hífen (2 a 40).' };
      return { config: { codigo, texto: String(c.texto ?? '').trim().slice(0, 200) } };
    }
    case 'anuncio':
      return { config: { ad_ids: (c.ad_ids ?? []).map((x) => String(x).replace(/\D/g, '')).filter(Boolean).slice(0, 50) } };
    case 'tag_adicionada': {
      const tag = String(c.tag ?? '').trim();
      if (!tag) return { erro: 'Escolha a tag.' };
      return { config: { tag } };
    }
    case 'padrao': {
      const h = Number(c.intervalo_horas ?? 24);
      return { config: { intervalo_horas: Number.isFinite(h) && h >= 0 ? Math.min(h, 720) : 24 } };
    }
    case 'webhook':
      return { config: { token: c.token && /^[a-f0-9]{24,64}$/.test(c.token) ? c.token : novoToken() } };
    case 'boas_vindas':
      return { config: {} };
  }
}

