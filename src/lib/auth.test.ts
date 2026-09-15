import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { credenciaisValidas, criarSessao, lerSessao, loginExigido, usuariosConfigurados } from './auth';

const ORIGINAL = process.env.APP_USERS;

beforeEach(() => {
  process.env.APP_USERS = 'bruno@empresa.com:senha-forte,ana@empresa.com:outra-senha';
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_USERS;
  else process.env.APP_USERS = ORIGINAL;
});

describe('usuariosConfigurados', () => {
  it('lê o formato email:senha separado por vírgula', () => {
    const m = usuariosConfigurados();
    expect(m.get('bruno@empresa.com')).toBe('senha-forte');
    expect(m.size).toBe(2);
  });

  it('senha com dois-pontos dentro continua inteira', () => {
    // O corte é no PRIMEIRO dois-pontos: uma senha como "a:b:c" tem de sobreviver.
    process.env.APP_USERS = 'x@y.com:a:b:c';
    expect(usuariosConfigurados().get('x@y.com')).toBe('a:b:c');
  });

  it('ignora entrada malformada em vez de quebrar o login inteiro', () => {
    process.env.APP_USERS = 'lixo,,bruno@empresa.com:ok';
    expect(usuariosConfigurados().size).toBe(1);
  });

  it('sem APP_USERS, não há usuário', () => {
    delete process.env.APP_USERS;
    expect(usuariosConfigurados().size).toBe(0);
    expect(loginExigido()).toBe(false);
  });
});

describe('credenciaisValidas', () => {
  it('aceita usuário e senha corretos', () => {
    expect(credenciaisValidas('bruno@empresa.com', 'senha-forte')).toBe(true);
  });
  it('e-mail não diferencia maiúsculas', () => {
    expect(credenciaisValidas('BRUNO@Empresa.com', 'senha-forte')).toBe(true);
  });
  it('recusa senha errada', () => {
    expect(credenciaisValidas('bruno@empresa.com', 'senha-fort')).toBe(false);
  });
  it('recusa usuário inexistente', () => {
    expect(credenciaisValidas('ninguem@empresa.com', 'senha-forte')).toBe(false);
  });
  it('recusa vazio', () => {
    expect(credenciaisValidas('', '')).toBe(false);
  });
});

describe('sessão', () => {
  it('ida e volta funciona', () => {
    const sessao = lerSessao(criarSessao('bruno@empresa.com'));
    expect(sessao?.usuario).toBe('bruno@empresa.com');
  });

  it('cookie adulterado é recusado — é a assinatura que sustenta o login', () => {
    const cookie = criarSessao('bruno@empresa.com');
    const [corpo, assinatura] = cookie.split('.');
    const outroCorpo = Buffer.from(
      JSON.stringify({ usuario: 'ana@empresa.com', expiraEm: Date.now() + 1000 }),
      'utf8',
    ).toString('base64url');
    // Troca o payload mantendo a assinatura antiga: o clássico "vou virar admin".
    expect(lerSessao(`${outroCorpo}.${assinatura}`)).toBeNull();
    expect(lerSessao(`${corpo}.assinatura-inventada`)).toBeNull();
  });

  it('sessão vencida é recusada', () => {
    const cookie = criarSessao('bruno@empresa.com', new Date('2026-01-01T00:00:00Z'));
    expect(lerSessao(cookie, new Date('2026-03-01T00:00:00Z'))).toBeNull();
  });

  it('usuário removido de APP_USERS perde a sessão na hora', () => {
    // É assim que se corta o acesso de quem saiu da equipe, sem esperar o cookie vencer.
    const cookie = criarSessao('bruno@empresa.com');
    process.env.APP_USERS = 'ana@empresa.com:outra-senha';
    expect(lerSessao(cookie)).toBeNull();
  });

  it('cookie ausente ou sem formato é recusado sem lançar', () => {
    expect(lerSessao(undefined)).toBeNull();
    expect(lerSessao('')).toBeNull();
    expect(lerSessao('semponto')).toBeNull();
    expect(lerSessao('.')).toBeNull();
  });
});
