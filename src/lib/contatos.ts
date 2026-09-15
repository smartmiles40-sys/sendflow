// Contatos: normalização e leitura de CSV.
//
// Tudo puro. A importação é o lugar onde mais entra lixo no sistema (planilha que
// alguém exportou do Excel, com BOM, ponto e vírgula e telefone formatado), então vale
// tratar aqui, com teste, em vez de descobrir na hora do disparo.

import { normalizarTelefoneBR, telefoneValido } from './whatsapp/jid';

/**
 * E-mail em minúsculas e sem espaço nas pontas.
 *
 * Não é cosmético: os índices únicos de `contacts.email` e `email_recipients.email`
 * são sobre a coluna CRUA (exigência do ON CONFLICT do PostgREST), então a unicidade
 * só existe de verdade se todo caminho de escrita passar por aqui.
 */
export function normalizarEmail(valor: string | null | undefined): string {
  return String(valor ?? '').trim().toLowerCase();
}

/**
 * Validação de e-mail deliberadamente simples: algo@algo.tld, sem espaços.
 *
 * Regex "completa" de RFC 5322 rejeita endereços válidos e aceita coisas que nenhum
 * servidor entrega. Quem valida de verdade é o provedor, no bounce — e o bounce já
 * volta para cá pelo webhook e marca o contato.
 */
export function emailValido(valor: string): boolean {
  const e = normalizarEmail(valor);
  return /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(e) && e.length <= 254;
}

// ── CSV ──────────────────────────────────────────────────────────────────────────

/**
 * Descobre o separador olhando a primeira linha.
 * Planilha brasileira exportada do Excel sai com `;` porque a vírgula é decimal aqui.
 */
export function detectarSeparador(primeiraLinha: string): string {
  const candidatos = [';', ',', '\t'];
  let melhor = ',';
  let maior = 0;
  for (const sep of candidatos) {
    // Conta fora de aspas, senão um campo "Silva, João" elege a vírgula sozinho.
    const n = contarForaDeAspas(primeiraLinha, sep);
    if (n > maior) {
      maior = n;
      melhor = sep;
    }
  }
  return melhor;
}

function contarForaDeAspas(linha: string, sep: string): number {
  let dentro = false;
  let n = 0;
  for (const ch of linha) {
    if (ch === '"') dentro = !dentro;
    else if (ch === sep && !dentro) n += 1;
  }
  return n;
}

/**
 * Leitor de CSV com o mínimo que um arquivo real exige: aspas, aspas duplicadas
 * dentro do campo (`""`), quebra de linha dentro de campo entre aspas, CRLF e BOM.
 */
export function parseCsv(texto: string, separador?: string): string[][] {
  // O BOM do Excel vira parte do nome da primeira coluna e quebra o mapeamento.
  const limpo = texto.replace(/^﻿/, '');
  const sep = separador ?? detectarSeparador(limpo.split(/\r?\n/)[0] ?? '');

  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let dentroDeAspas = false;

  for (let i = 0; i < limpo.length; i++) {
    const ch = limpo[i];

    if (dentroDeAspas) {
      if (ch === '"') {
        if (limpo[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += ch;
      }
      continue;
    }

    if (ch === '"') {
      dentroDeAspas = true;
    } else if (ch === sep) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n') {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else if (ch !== '\r') {
      campo += ch;
    }
  }

  if (campo !== '' || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }

  return linhas.filter((l) => l.some((c) => c.trim() !== ''));
}

/** Nomes de coluna aceitos para cada campo, já sem acento e em minúsculas. */
const SINONIMOS: Record<string, string[]> = {
  nome: ['nome', 'name', 'nome completo', 'fullname', 'full name', 'contato', 'cliente'],
  email: ['email', 'e-mail', 'mail', 'endereco de email', 'correio'],
  telefone: ['telefone', 'celular', 'whatsapp', 'fone', 'phone', 'numero', 'tel', 'zap'],
  empresa: ['empresa', 'company', 'organizacao', 'negocio'],
  tags: ['tags', 'tag', 'etiquetas', 'marcadores', 'segmento'],
};

/** Tira acento, espaço duplicado e caixa, para comparar cabeçalho de planilha. */
export function chaveDeColuna(valor: string): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export interface MapaColunas {
  nome: number | null;
  email: number | null;
  telefone: number | null;
  empresa: number | null;
  tags: number | null;
  /** Colunas que sobraram viram campos livres para personalizar a mensagem. */
  extras: { chave: string; indice: number }[];
}

/** Casa o cabeçalho do arquivo com os campos do contato. */
export function mapearColunas(cabecalho: string[]): MapaColunas {
  const mapa: MapaColunas = {
    nome: null,
    email: null,
    telefone: null,
    empresa: null,
    tags: null,
    extras: [],
  };
  // Só os campos fixos do contato; `extras` não entra no casamento por sinônimo.
  const campos = ['nome', 'email', 'telefone', 'empresa', 'tags'] as const;

  cabecalho.forEach((bruto, i) => {
    const chave = chaveDeColuna(bruto);
    // `mapa[campo] === null` garante que a PRIMEIRA coluna vence: numa planilha com
    // "email" e "email secundário", o secundário vira campo livre em vez de sobrescrever.
    const campo = campos.find((k) => SINONIMOS[k].includes(chave) && mapa[k] === null);
    if (campo) {
      mapa[campo] = i;
    } else if (chave) {
      mapa.extras.push({ chave: chave.replace(/[^a-z0-9_]+/g, '_'), indice: i });
    }
  });
  return mapa;
}

export interface ContatoImportado {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  tags: string[];
  campos: Record<string, string>;
}

export interface ResultadoLeitura {
  contatos: ContatoImportado[];
  /** Uma linha por problema, com o número da linha do arquivo — para a pessoa corrigir. */
  ignoradas: { linha: number; motivo: string }[];
  colunas: MapaColunas;
  total: number;
}

/**
 * Lê o CSV inteiro e devolve contatos prontos para gravar.
 *
 * Regra de corte: a linha precisa ter e-mail válido OU telefone plausível. Sem nenhum
 * dos dois, não é contato — é linha em branco com nome.
 */
export function lerCsvDeContatos(texto: string): ResultadoLeitura {
  const linhas = parseCsv(texto);
  if (!linhas.length) {
    return { contatos: [], ignoradas: [], colunas: mapearColunas([]), total: 0 };
  }

  const colunas = mapearColunas(linhas[0]);
  const corpo = linhas.slice(1);
  const contatos: ContatoImportado[] = [];
  const ignoradas: { linha: number; motivo: string }[] = [];
  const vistosEmail = new Set<string>();
  const vistosTelefone = new Set<string>();

  const celula = (linha: string[], i: number | null) =>
    i === null ? '' : (linha[i] ?? '').trim();

  corpo.forEach((linha, idx) => {
    const numeroLinha = idx + 2; // +1 do cabeçalho, +1 porque planilha começa em 1
    const emailBruto = celula(linha, colunas.email);
    const telefoneBruto = celula(linha, colunas.telefone);

    const email = emailBruto ? normalizarEmail(emailBruto) : '';
    const telefone = telefoneBruto ? normalizarTelefoneBR(telefoneBruto) : '';

    if (email && !emailValido(email)) {
      ignoradas.push({ linha: numeroLinha, motivo: `E-mail inválido: ${emailBruto}` });
      return;
    }
    if (telefone && !telefoneValido(telefone)) {
      ignoradas.push({ linha: numeroLinha, motivo: `Telefone inválido: ${telefoneBruto}` });
      return;
    }
    if (!email && !telefone) {
      ignoradas.push({ linha: numeroLinha, motivo: 'Sem e-mail e sem telefone.' });
      return;
    }
    // Duplicado DENTRO do arquivo. O que já existe no banco é resolvido no upsert.
    if (email && vistosEmail.has(email)) {
      ignoradas.push({ linha: numeroLinha, motivo: `Repetido no arquivo: ${email}` });
      return;
    }
    if (!email && telefone && vistosTelefone.has(telefone)) {
      ignoradas.push({ linha: numeroLinha, motivo: `Repetido no arquivo: ${telefoneBruto}` });
      return;
    }
    if (email) vistosEmail.add(email);
    if (telefone) vistosTelefone.add(telefone);

    const campos: Record<string, string> = {};
    for (const extra of colunas.extras) {
      const v = celula(linha, extra.indice);
      if (v) campos[extra.chave] = v;
    }

    contatos.push({
      nome: celula(linha, colunas.nome) || null,
      email: email || null,
      telefone: telefone || null,
      empresa: celula(linha, colunas.empresa) || null,
      tags: separarTags(celula(linha, colunas.tags)),
      campos,
    });
  });

  return { contatos, ignoradas, colunas, total: corpo.length };
}

/** `"vip, cliente; 2026"` → `['vip','cliente','2026']`. */
export function separarTags(valor: string): string[] {
  return String(valor ?? '')
    .split(/[,;|]/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** União de tags sem repetir, preservando a ordem de chegada. */
export function unirTags(...listas: (string[] | null | undefined)[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const lista of listas) {
    for (const t of lista ?? []) {
      const tag = t.trim().toLowerCase();
      if (tag && !vistos.has(tag)) {
        vistos.add(tag);
        saida.push(tag);
      }
    }
  }
  return saida;
}
