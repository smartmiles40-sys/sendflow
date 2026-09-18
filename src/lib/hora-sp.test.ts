import { describe, it, expect } from 'vitest';
import { isoDeSP, partesSP, somarDias } from './hora-sp';

describe('hora de Brasília', () => {
  it('ida e volta sem depender do fuso da máquina', () => {
    const iso = isoDeSP('2026-09-20', '20:00');
    expect(iso).toBe('2026-09-20T23:00:00.000Z');
    expect(partesSP(iso as string)).toEqual({ data: '2026-09-20', hora: '20:00' });
  });

  it('virada do dia: 23h30 em SP já é o dia seguinte em UTC', () => {
    expect(isoDeSP('2026-09-20', '23:30')).toBe('2026-09-21T02:30:00.000Z');
    expect(partesSP('2026-09-21T02:30:00.000Z').data).toBe('2026-09-20');
  });

  it('entrada inválida vira nulo', () => {
    expect(isoDeSP('20/09/2026', '20:00')).toBeNull();
    expect(isoDeSP('2026-09-20', '')).toBeNull();
  });

  it('somar dias mantém a hora', () => {
    expect(partesSP(somarDias('2026-09-20T23:00:00.000Z', 7))).toEqual({ data: '2026-09-27', hora: '20:00' });
  });
});
