import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HORIZONTE_SEMANAS,
  cancelarFuturas,
  refillRecorrencia,
  sincronizarFuturas,
} from './recorrencia-refill';
import type { Recorrencia } from './types';

// Sexta 09:00 em São Paulo.
const AGORA = new Date('2026-08-28T12:00:00.000Z');

const REC: Recorrencia = {
  id: 'r1',
  nome: 'Comunidade semanal',
  categoria: 'comunidade',
  dia_semana: 1, // segunda
  hora: '09:00',
  tipo: 'texto',
  mensagem: 'Bom dia!',
  midia_url: null,
  mencionar_todos: false,
  audience_id: 'aud-1',
  group_ids: null,
  ativo: true,
  criado_em: AGORA.toISOString(),
  atualizado_em: AGORA.toISOString(),
};

type Call = { table: string; method: string; args: unknown[] };

/**
 * Cliente Supabase falso: o builder é encadeável e "thenable", devolvendo os
 * resultados enfileirados na ordem em que cada consulta é aguardada. Guarda todas
 * as chamadas para as asserções.
 */
function fakeClient(results: { data?: unknown; error?: { message: string } | null }[]) {
  const calls: Call[] = [];
  let i = 0;
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'upsert', 'update', 'insert', 'delete', 'eq', 'gt', 'in', 'order']) {
      b[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return b;
      };
    }
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(results[i++] ?? { data: [], error: null });
    return b;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe('refillRecorrencia', () => {
  it('não toca no banco quando a recorrência está pausada', async () => {
    const { client, calls } = fakeClient([]);
    const out = await refillRecorrencia(client, { ...REC, ativo: false }, AGORA);
    expect(out).toEqual({ criadas: 0, error: null });
    expect(calls).toHaveLength(0);
  });

  it('faz upsert das ocorrências do horizonte com onConflict (idempotente)', async () => {
    const { client, calls } = fakeClient([{ data: [{ id: 'a' }, { id: 'b' }], error: null }]);
    const out = await refillRecorrencia(client, REC, AGORA);

    const upsert = calls.find((c) => c.method === 'upsert');
    const rows = upsert?.args[0] as { enviar_em: string; recorrencia_id: string }[];
    expect(rows).toHaveLength(HORIZONTE_SEMANAS);
    expect(rows[0].enviar_em).toBe('2026-08-31T12:00:00.000Z');
    expect(rows.every((r) => r.recorrencia_id === 'r1')).toBe(true);
    expect(upsert?.args[1]).toEqual({
      onConflict: 'recorrencia_id,enviar_em',
      ignoreDuplicates: true,
    });
    // Só o que o banco realmente inseriu conta como criado.
    expect(out).toEqual({ criadas: 2, error: null });
  });

  it('propaga erro do banco sem contar criações', async () => {
    const { client } = fakeClient([{ data: null, error: { message: 'boom' } }]);
    expect(await refillRecorrencia(client, REC, AGORA)).toEqual({ criadas: 0, error: 'boom' });
  });
});

describe('sincronizarFuturas', () => {
  it('reescreve o que continua na grade e cancela o que saiu dela', async () => {
    const { client, calls } = fakeClient([
      {
        data: [
          // Segunda 31/08 — segue na grade (formato timestamptz do PostgREST).
          { id: 'c1', enviar_em: '2026-08-31T12:00:00+00:00' },
          // Terça 01/09 — sobrou de um dia da semana antigo.
          { id: 'c2', enviar_em: '2026-09-01T12:00:00+00:00' },
        ],
        error: null,
      },
      { data: null, error: null }, // update c1
      { data: null, error: null }, // update c2
      { data: [{ id: 'novo' }], error: null }, // refill
    ]);

    const out = await sincronizarFuturas(client, REC, AGORA);
    expect(out.error).toBeNull();

    const updates = calls.filter((c) => c.method === 'update');
    expect(updates).toHaveLength(2);
    // O primeiro update reescreve o conteúdo a partir do molde…
    expect(updates[0].args[0]).toMatchObject({
      nome: 'Comunidade semanal — 31/08',
      mensagem: 'Bom dia!',
      audience_id: 'aud-1',
    });
    // …e o segundo cancela a ocorrência fora da grade.
    expect(updates[1].args[0]).toEqual({ status: 'cancelada' });
    const alvoCancelado = calls.find(
      (c) => c.method === 'eq' && c.args[0] === 'id' && c.args[1] === 'c2',
    );
    expect(alvoCancelado).toBeDefined();
  });

  it('pausada: cancela as futuras e não agenda nada', async () => {
    const { client, calls } = fakeClient([{ data: null, error: null }]);
    const out = await sincronizarFuturas(client, { ...REC, ativo: false }, AGORA);
    expect(out).toEqual({ criadas: 0, error: null });
    expect(calls.some((c) => c.method === 'upsert')).toBe(false);
    expect(calls.find((c) => c.method === 'update')?.args[0]).toEqual({ status: 'cancelada' });
  });
});

describe('cancelarFuturas', () => {
  it('só mexe nas agendadas futuras da recorrência', async () => {
    const { client, calls } = fakeClient([{ data: null, error: null }]);
    expect(await cancelarFuturas(client, 'r1', AGORA)).toBeNull();
    expect(calls.find((c) => c.method === 'update')?.args[0]).toEqual({ status: 'cancelada' });
    expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
      ['recorrencia_id', 'r1'],
      ['status', 'agendada'],
    ]);
    expect(calls.find((c) => c.method === 'gt')?.args).toEqual([
      'enviar_em',
      '2026-08-28T12:00:00.000Z',
    ]);
  });
});
