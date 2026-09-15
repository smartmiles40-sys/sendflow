import { describe, it, expect } from 'vitest';
import {
  chaveDeColuna,
  detectarSeparador,
  emailValido,
  lerCsvDeContatos,
  mapearColunas,
  normalizarEmail,
  parseCsv,
  separarTags,
  unirTags,
} from './contatos';

describe('normalizarEmail', () => {
  it('baixa a caixa e tira espaços', () => {
    expect(normalizarEmail('  Bruno@Empresa.COM.br ')).toBe('bruno@empresa.com.br');
  });
});

describe('emailValido', () => {
  it('aceita endereços comuns', () => {
    expect(emailValido('bruno@empresa.com.br')).toBe(true);
    expect(emailValido('a.b+tag@sub.dominio.io')).toBe(true);
  });
  it('recusa o que nenhum servidor entrega', () => {
    expect(emailValido('sem-arroba')).toBe(false);
    expect(emailValido('a@b')).toBe(false);
    expect(emailValido('a b@c.com')).toBe(false);
    expect(emailValido('a@b.com,c@d.com')).toBe(false);
  });
});

describe('detectarSeparador', () => {
  it('detecta ponto e vírgula (o padrão do Excel em português)', () => {
    expect(detectarSeparador('nome;email;telefone')).toBe(';');
  });
  it('detecta vírgula', () => {
    expect(detectarSeparador('nome,email,telefone')).toBe(',');
  });
  it('não se confunde com vírgula dentro de aspas', () => {
    expect(detectarSeparador('"Silva, João";email;tel')).toBe(';');
  });
});

describe('parseCsv', () => {
  it('lê linhas e colunas simples', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('respeita aspas com separador dentro', () => {
    expect(parseCsv('nome,obs\n"Silva, João",ok')).toEqual([
      ['nome', 'obs'],
      ['Silva, João', 'ok'],
    ]);
  });
  it('entende aspas duplicadas dentro do campo', () => {
    expect(parseCsv('a\n"diz ""oi"""')).toEqual([['a'], ['diz "oi"']]);
  });
  it('entende quebra de linha dentro de campo entre aspas', () => {
    expect(parseCsv('a,b\n"linha 1\nlinha 2",x')).toEqual([
      ['a', 'b'],
      ['linha 1\nlinha 2', 'x'],
    ]);
  });
  it('lida com CRLF do Windows', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('remove o BOM do Excel, que senão gruda no nome da primeira coluna', () => {
    const colunas = mapearColunas(parseCsv('﻿email,nome')[0]);
    expect(colunas.email).toBe(0);
  });
  it('descarta linhas totalmente vazias', () => {
    expect(parseCsv('a\n\n1')).toEqual([['a'], ['1']]);
  });
});

describe('chaveDeColuna', () => {
  it('tira acento e caixa para comparar cabeçalho', () => {
    expect(chaveDeColuna(' E-MAIL ')).toBe('e-mail');
    expect(chaveDeColuna('Organização')).toBe('organizacao');
  });
});

describe('mapearColunas', () => {
  it('reconhece os sinônimos mais comuns', () => {
    const m = mapearColunas(['Nome Completo', 'E-mail', 'Celular', 'Empresa', 'Tags']);
    expect(m).toMatchObject({ nome: 0, email: 1, telefone: 2, empresa: 3, tags: 4 });
  });
  it('coluna desconhecida vira variável livre', () => {
    const m = mapearColunas(['email', 'Cidade']);
    expect(m.extras).toEqual([{ chave: 'cidade', indice: 1 }]);
  });
  it('a PRIMEIRA coluna vence: "email secundário" não sobrescreve "email"', () => {
    const m = mapearColunas(['email', 'email secundario']);
    expect(m.email).toBe(0);
    expect(m.extras.some((e) => e.chave === 'email_secundario')).toBe(true);
  });
});

describe('lerCsvDeContatos', () => {
  it('lê um arquivo comum', () => {
    const r = lerCsvDeContatos('nome;email;telefone\nMaria;MARIA@x.com;(11) 99999-8888');
    expect(r.contatos).toHaveLength(1);
    expect(r.contatos[0]).toMatchObject({
      nome: 'Maria',
      email: 'maria@x.com',
      telefone: '5511999998888',
    });
  });

  it('aceita linha só com telefone', () => {
    const r = lerCsvDeContatos('nome,telefone\nJoão,11999998888');
    expect(r.contatos).toHaveLength(1);
    expect(r.contatos[0].email).toBeNull();
  });

  it('aceita linha só com e-mail', () => {
    const r = lerCsvDeContatos('nome,email\nAna,ana@x.com');
    expect(r.contatos[0].telefone).toBeNull();
  });

  it('ignora linha sem e-mail e sem telefone, dizendo o número da linha', () => {
    const r = lerCsvDeContatos('nome,email\nSó o nome,');
    expect(r.contatos).toHaveLength(0);
    expect(r.ignoradas[0]).toMatchObject({ linha: 2 });
  });

  it('ignora e-mail inválido em vez de gravar lixo na base', () => {
    const r = lerCsvDeContatos('email\nnao-eh-email');
    expect(r.contatos).toHaveLength(0);
    expect(r.ignoradas[0].motivo).toMatch(/inválido/);
  });

  it('ignora telefone impossível', () => {
    const r = lerCsvDeContatos('telefone\n123');
    expect(r.contatos).toHaveLength(0);
    expect(r.ignoradas[0].motivo).toMatch(/Telefone inválido/);
  });

  it('remove duplicado DENTRO do arquivo', () => {
    const r = lerCsvDeContatos('email\na@x.com\nA@X.COM');
    expect(r.contatos).toHaveLength(1);
    expect(r.ignoradas[0].motivo).toMatch(/Repetido/);
  });

  it('guarda as colunas extras como campos de personalização', () => {
    const r = lerCsvDeContatos('email,Cidade\na@x.com,Recife');
    expect(r.contatos[0].campos).toEqual({ cidade: 'Recife' });
  });

  it('separa as tags da coluna de tags', () => {
    const r = lerCsvDeContatos('email,tags\na@x.com,"vip, cliente"');
    expect(r.contatos[0].tags).toEqual(['vip', 'cliente']);
  });

  it('arquivo vazio não quebra', () => {
    expect(lerCsvDeContatos('').contatos).toHaveLength(0);
  });

  it('só cabeçalho devolve zero contatos e zero ignoradas', () => {
    const r = lerCsvDeContatos('nome,email');
    expect(r.contatos).toHaveLength(0);
    expect(r.total).toBe(0);
  });
});

describe('separarTags', () => {
  it('aceita vírgula, ponto e vírgula e barra', () => {
    expect(separarTags('vip, Cliente;2026|Novo')).toEqual(['vip', 'cliente', '2026', 'novo']);
  });
});

describe('unirTags', () => {
  it('soma sem repetir e preservando a ordem', () => {
    expect(unirTags(['vip'], ['cliente', 'VIP'], ['novo'])).toEqual(['vip', 'cliente', 'novo']);
  });
  it('aceita nulo sem quebrar', () => {
    expect(unirTags(null, undefined, ['a'])).toEqual(['a']);
  });
});
