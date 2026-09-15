import { describe, it, expect } from 'vitest';
import {
  dentroDaJanela,
  inicioDoDiaSP,
  liberadaEm,
  Orcamento,
  proximoEnvio,
  saldoDiario,
  sortearIntervaloMs,
} from './ritmo';

describe('sortearIntervaloMs', () => {
  it('fica dentro da faixa pedida', () => {
    for (let i = 0; i <= 10; i++) {
      const ms = sortearIntervaloMs(8, 15, i / 10);
      expect(ms).toBeGreaterThanOrEqual(8000);
      expect(ms).toBeLessThanOrEqual(15000);
    }
  });
  it('aleatorio = 1 não estoura o teto (o sorteio é travado abaixo de 1)', () => {
    expect(sortearIntervaloMs(8, 15, 1)).toBeLessThanOrEqual(15000);
  });
  it('faixa de um valor só devolve sempre o mesmo', () => {
    expect(sortearIntervaloMs(10, 10, 0.5)).toBe(10000);
  });
  it('máximo menor que o mínimo não inverte a faixa', () => {
    expect(sortearIntervaloMs(15, 8, 0.5)).toBe(15000);
  });
});

describe('liberadaEm', () => {
  const agora = new Date('2026-09-15T12:00:00Z');
  it('sem marca anterior, está liberada', () => {
    expect(liberadaEm(null, agora)).toBe(true);
  });
  it('marca no passado, está liberada', () => {
    expect(liberadaEm('2026-09-15T11:59:50Z', agora)).toBe(true);
  });
  it('marca no futuro, ainda espera', () => {
    expect(liberadaEm('2026-09-15T12:00:10Z', agora)).toBe(false);
  });
  it('data inválida não trava a fila para sempre', () => {
    expect(liberadaEm('nada disso', agora)).toBe(true);
  });
});

describe('proximoEnvio', () => {
  it('sempre cai no futuro', () => {
    const agora = new Date('2026-09-15T12:00:00Z');
    const proximo = new Date(proximoEnvio(agora, 8, 15, 0.5)).getTime();
    expect(proximo).toBeGreaterThan(agora.getTime());
  });
});

describe('inicioDoDiaSP', () => {
  it('meia-noite em São Paulo é 03:00 UTC', () => {
    expect(inicioDoDiaSP(new Date('2026-09-15T18:00:00Z'))).toBe('2026-09-15T03:00:00.000Z');
  });
  it('01:00 UTC ainda é o dia ANTERIOR em São Paulo (22h de ontem)', () => {
    // O erro clássico de contar limite diário em UTC: tudo que sai entre 21h e meia-noite
    // seria jogado para o dia seguinte, e o teto do número estouraria sem ninguém entender.
    expect(inicioDoDiaSP(new Date('2026-09-16T01:00:00Z'))).toBe('2026-09-15T03:00:00.000Z');
  });
});

describe('saldoDiario', () => {
  it('limite zero significa sem teto', () => {
    expect(saldoDiario(0, 9999)).toBe(Number.POSITIVE_INFINITY);
  });
  it('desconta o que já saiu', () => {
    expect(saldoDiario(500, 120)).toBe(380);
  });
  it('nunca fica negativo', () => {
    expect(saldoDiario(100, 250)).toBe(0);
  });
});

describe('dentroDaJanela', () => {
  // 15:00 UTC = 12:00 em São Paulo
  const meioDia = new Date('2026-09-15T15:00:00Z');
  const madrugada = new Date('2026-09-15T06:00:00Z'); // 03:00 em SP

  it('meio-dia está dentro de 08:00–21:00', () => {
    expect(dentroDaJanela(meioDia, '08:00', '21:00')).toBe(true);
  });
  it('três da manhã está fora de 08:00–21:00', () => {
    expect(dentroDaJanela(madrugada, '08:00', '21:00')).toBe(false);
  });
  it('janela que cruza a meia-noite funciona', () => {
    expect(dentroDaJanela(madrugada, '22:00', '06:00')).toBe(true);
    expect(dentroDaJanela(meioDia, '22:00', '06:00')).toBe(false);
  });
  it('horário inválido não bloqueia o envio', () => {
    expect(dentroDaJanela(madrugada, 'xx', '21:00')).toBe(true);
  });
});

describe('Orcamento', () => {
  it('cabe enquanto sobra tempo', () => {
    const o = new Orcamento(45_000, Date.now());
    expect(o.cabe(6_000)).toBe(true);
  });
  it('não cabe quando o tempo já acabou', () => {
    const o = new Orcamento(1_000, Date.now() - 5_000);
    expect(o.cabe(1)).toBe(false);
  });
});
