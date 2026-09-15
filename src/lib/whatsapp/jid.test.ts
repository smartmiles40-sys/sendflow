import { describe, it, expect } from 'vitest';
import {
  ehGrupo,
  formatarTelefone,
  normalizarDestino,
  normalizarTelefoneBR,
  somenteDigitos,
  telefoneValido,
} from './jid';

describe('ehGrupo', () => {
  it('reconhece o JID nativo do WhatsApp', () => {
    expect(ehGrupo('120363021234567890@g.us')).toBe(true);
  });
  it('reconhece o formato herdado do Z-API', () => {
    expect(ehGrupo('120363021234567890-group')).toBe(true);
  });
  it('um telefone não é grupo', () => {
    expect(ehGrupo('5511999998888')).toBe(false);
  });
});

describe('normalizarDestino', () => {
  it('converte o dialeto do Z-API para o da Evolution', () => {
    expect(normalizarDestino('120363021234567890-group')).toBe('120363021234567890@g.us');
  });
  it('mantém o JID que já está certo', () => {
    expect(normalizarDestino('120363021234567890@g.us')).toBe('120363021234567890@g.us');
  });
  it('os dois dialetos viram o MESMO destino (é o que faz o dedupe funcionar)', () => {
    expect(normalizarDestino('120363021234567890-group')).toBe(
      normalizarDestino('120363021234567890@g.us'),
    );
  });
  it('limpa a máscara de um telefone digitado', () => {
    expect(normalizarDestino('+55 (11) 99999-8888')).toBe('5511999998888');
  });
  it('tira o sufixo de contato do WhatsApp', () => {
    expect(normalizarDestino('5511999998888@s.whatsapp.net')).toBe('5511999998888');
  });
  it('devolve vazio para lixo, em vez de mandar lixo para a API', () => {
    expect(normalizarDestino('   ')).toBe('');
    expect(normalizarDestino('-group')).toBe('');
  });
});

describe('normalizarTelefoneBR', () => {
  it('acrescenta o DDI em número com DDD + 9 dígitos', () => {
    expect(normalizarTelefoneBR('11999998888')).toBe('5511999998888');
  });
  it('acrescenta o DDI em número antigo de 8 dígitos', () => {
    expect(normalizarTelefoneBR('1133334444')).toBe('551133334444');
  });
  it('não mexe em número que já tem DDI', () => {
    expect(normalizarTelefoneBR('5511999998888')).toBe('5511999998888');
  });
  it('NÃO inventa o nono dígito — o número antigo existe como a operadora deu', () => {
    expect(normalizarTelefoneBR('551133334444')).toBe('551133334444');
  });
  it('deixa número estrangeiro em paz em vez de chutar DDI', () => {
    expect(normalizarTelefoneBR('+351 912 345 678')).toBe('351912345678');
  });
});

describe('formatarTelefone', () => {
  it('formata celular brasileiro', () => {
    expect(formatarTelefone('5511999998888')).toBe('+55 11 99999-8888');
  });
  it('formata fixo brasileiro', () => {
    expect(formatarTelefone('551133334444')).toBe('+55 11 3333-4444');
  });
});

describe('telefoneValido', () => {
  it('aceita a faixa plausível de E.164', () => {
    expect(telefoneValido('5511999998888')).toBe(true);
  });
  it('recusa curto demais', () => {
    expect(telefoneValido('99998888')).toBe(false);
  });
  it('recusa longo demais', () => {
    expect(telefoneValido('1'.repeat(16))).toBe(false);
  });
});

describe('somenteDigitos', () => {
  it('remove tudo que não é número', () => {
    expect(somenteDigitos('+55 (11) 9.9999-8888')).toBe('5511999998888');
  });
});
