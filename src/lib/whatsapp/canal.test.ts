import { describe, it, expect } from 'vitest';
import { conectorCerto, validarCanal } from './canal';

const chip = { provider: 'evolution' as const, nome: 'MKT', status: 'conectada' as const };
const oficial = { provider: 'cloud' as const, nome: 'Marketing oficial', status: 'conectada' as const };
const template = {
  status: 'APPROVED' as const,
  variaveis_corpo: 2,
  variaveis_cabecalho: 0,
  cabecalho_tipo: null,
};

describe('validarCanal — grupos', () => {
  it('grupo pelo chip está certo', () => {
    expect(validarCanal({ alvo: 'grupos', conexao: chip, template: null, variaveis: null })).toEqual([]);
  });

  it('grupo pela API oficial é recusado: a Meta não expõe grupos', () => {
    const p = validarCanal({ alvo: 'grupos', conexao: oficial, template: null, variaveis: null });
    expect(p).toHaveLength(1);
    expect(p[0].field).toBe('connection_id');
    expect(p[0].message).toMatch(/não envia para grupos/i);
  });

  it('grupo sem conexão escolhida passa — o motor usa a conexão do próprio grupo', () => {
    expect(validarCanal({ alvo: 'grupos', conexao: null, template: null, variaveis: null })).toEqual([]);
  });
});

describe('validarCanal — contatos (a regra)', () => {
  const completo = { '1': '{{primeiro_nome}}', '2': 'Japão' };

  it('contatos pela API oficial, com template aprovado e variáveis completas', () => {
    expect(
      validarCanal({
        alvo: 'contatos',
        conexao: oficial,
        template,
        variaveis: completo,
        templateNome: 'live_japao',
      }),
    ).toEqual([]);
  });

  it('BLOQUEIA disparo em massa pelo chip', () => {
    const p = validarCanal({
      alvo: 'contatos',
      conexao: chip,
      template,
      variaveis: completo,
      templateNome: 'live_japao',
    });
    expect(p[0].field).toBe('connection_id');
    expect(p[0].message).toMatch(/bloqueio de 24 h/i);
  });

  it('BLOQUEIA disparo em massa sem conexão nenhuma', () => {
    const p = validarCanal({ alvo: 'contatos', conexao: null, template: null, variaveis: null });
    expect(p[0].field).toBe('connection_id');
  });

  it('exige template', () => {
    const p = validarCanal({ alvo: 'contatos', conexao: oficial, template: null, variaveis: null });
    expect(p[0].field).toBe('template_nome');
    expect(p[0].message).toMatch(/template/i);
  });

  it('recusa template que não está APPROVED', () => {
    const p = validarCanal({
      alvo: 'contatos',
      conexao: oficial,
      template: { ...template, status: 'PAUSED' },
      variaveis: completo,
      templateNome: 'live_japao',
    });
    expect(p.some((x) => x.message.includes('PAUSED'))).toBe(true);
  });

  it('conta as variáveis ANTES do disparo — este é o erro 132000 evitado', () => {
    const p = validarCanal({
      alvo: 'contatos',
      conexao: oficial,
      template,
      variaveis: { '1': 'Maria' },
      templateNome: 'live_japao',
    });
    expect(p[0].field).toBe('template_variaveis');
    expect(p[0].message).toMatch(/faltam 1/);
  });

  it('variável preenchida só com espaço não conta como preenchida', () => {
    const p = validarCanal({
      alvo: 'contatos',
      conexao: oficial,
      template,
      variaveis: { '1': 'Maria', '2': '   ' },
      templateNome: 'live_japao',
    });
    expect(p[0].field).toBe('template_variaveis');
  });

  it('template com cabeçalho de imagem exige o arquivo', () => {
    const p = validarCanal({
      alvo: 'contatos',
      conexao: oficial,
      template: { ...template, cabecalho_tipo: 'IMAGE' },
      variaveis: completo,
      templateNome: 'live_japao',
    });
    expect(p[0].field).toBe('template_cabecalho_url');
  });

  it('avisa quando o número oficial não está pronto', () => {
    const p = validarCanal({
      alvo: 'contatos',
      conexao: { ...oficial, status: 'erro' },
      template,
      variaveis: completo,
      templateNome: 'live_japao',
    });
    expect(p.some((x) => x.message.includes('não está pronto'))).toBe(true);
  });
});

describe('conectorCerto', () => {
  it('grupo só pela Evolution', () => {
    expect(conectorCerto('grupo', 'evolution')).toBe(true);
    expect(conectorCerto('grupo', 'cloud')).toBe(false);
  });
  it('contato só pela API oficial', () => {
    expect(conectorCerto('contato', 'cloud')).toBe(true);
    expect(conectorCerto('contato', 'evolution')).toBe(false);
  });
});
