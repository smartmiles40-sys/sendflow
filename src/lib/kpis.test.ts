import { describe, it, expect } from 'vitest';
import {
  avaliar,
  conselho,
  diaSP,
  formatarDuracao,
  formatarNumero,
  formatarTaxa,
  REFERENCIAS,
  taxa,
} from './kpis';

describe('taxa', () => {
  it('calcula percentual com uma casa', () => {
    expect(taxa(1, 3)).toBe(33.3);
  });
  it('denominador zero devolve null, não zero', () => {
    // "Ainda não dá para dizer" e "zero por cento" são coisas diferentes: uma campanha
    // recém-disparada com 0% de abertura assusta; "—" porque ninguém recebeu, não.
    expect(taxa(0, 0)).toBeNull();
  });
  it('cem por cento é cem', () => {
    expect(taxa(7, 7)).toBe(100);
  });
});

describe('formatarTaxa', () => {
  it('usa vírgula decimal e o sinal de porcentagem', () => {
    expect(formatarTaxa(45.7)).toBe('45,7%');
  });
  it('null vira travessão', () => {
    expect(formatarTaxa(null)).toBe('—');
    expect(formatarTaxa(undefined)).toBe('—');
  });
});

describe('formatarNumero', () => {
  it('usa separador de milhar brasileiro', () => {
    expect(formatarNumero(1234567)).toBe('1.234.567');
  });
  it('null vira travessão', () => {
    expect(formatarNumero(null)).toBe('—');
  });
  it('zero é zero, não travessão', () => {
    expect(formatarNumero(0)).toBe('0');
  });
});

describe('formatarDuracao', () => {
  it('segundos', () => {
    expect(formatarDuracao(42)).toBe('42s');
  });
  it('minutos', () => {
    expect(formatarDuracao(420)).toBe('7min');
  });
  it('horas com minutos', () => {
    expect(formatarDuracao(11520)).toBe('3h 12min');
  });
  it('dias', () => {
    expect(formatarDuracao(187200)).toBe('2d 4h');
  });
  it('null vira travessão', () => {
    expect(formatarDuracao(null)).toBe('—');
  });
});

describe('diaSP', () => {
  it('usa a data de São Paulo, não a UTC', () => {
    // 01:00Z de 16/09 ainda é 22:00 do dia 15 em São Paulo.
    expect(diaSP(new Date('2026-09-16T01:00:00Z'))).toBe('2026-09-15');
  });
  it('meio-dia UTC é o mesmo dia', () => {
    expect(diaSP(new Date('2026-09-15T12:00:00Z'))).toBe('2026-09-15');
  });
});

describe('avaliar', () => {
  it('maior é melhor: classifica pela faixa', () => {
    const r = REFERENCIAS.email_abertura;
    expect(avaliar(40, r)).toBe('bom');
    expect(avaliar(27, r)).toBe('ok');
    expect(avaliar(18, r)).toBe('atencao');
    expect(avaliar(9, r)).toBe('ruim');
  });
  it('menor é melhor inverte a escala (bounce, spam)', () => {
    const r = REFERENCIAS.email_bounce;
    expect(avaliar(0.2, r)).toBe('bom');
    expect(avaliar(1.5, r)).toBe('ok');
    expect(avaliar(4, r)).toBe('atencao');
    expect(avaliar(12, r)).toBe('ruim');
  });
  it('sem valor é indefinido, nunca "ruim"', () => {
    expect(avaliar(null, REFERENCIAS.email_abertura)).toBe('indefinido');
  });
});

describe('conselho', () => {
  it('dá orientação quando o número está fraco', () => {
    expect(conselho('email_abertura', 'ruim')).toMatch(/ASSUNTO/);
  });
  it('não enche a tela quando está bom ou não dá para dizer', () => {
    expect(conselho('email_abertura', 'bom')).toBeNull();
    expect(conselho('email_abertura', 'indefinido')).toBeNull();
  });
});
