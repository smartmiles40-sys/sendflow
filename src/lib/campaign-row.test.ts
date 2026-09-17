import { describe, it, expect } from 'vitest';
import { buildCampaignRow } from './campaign-row';
import type { CampaignDraft } from './validation';

const now = new Date('2026-08-20T12:00:00Z');
const draft: CampaignDraft = {
  nome: 'Feriado', tipo: 'imagem', mensagem: 'Bom dia',
  midia_url: 'https://x/y.jpg', mencionar_todos: true,
  agendar: true, enviar_em: '2026-08-21T09:00:00Z',
};

describe('buildCampaignRow', () => {
  it('maps a scheduled draft to an agendada row', () => {
    const row = buildCampaignRow(draft, { audienceId: 'aud-1' }, now, { asDraft: false });
    expect(row).toMatchObject({
      nome: 'Feriado', tipo: 'imagem', mensagem: 'Bom dia',
      midia_url: 'https://x/y.jpg', mencionar_todos: true,
      audience_id: 'aud-1', status: 'agendada', enviar_em: '2026-08-21T09:00:00Z',
    });
  });
  it('send-now sets status agendada with enviar_em = now', () => {
    const row = buildCampaignRow({ ...draft, agendar: false, enviar_em: null }, {}, now, { asDraft: false });
    expect(row.status).toBe('agendada');
    expect(row.enviar_em).toBe(now.toISOString());
    expect(row.audience_id).toBeNull();
  });
  it('asDraft forces status rascunho', () => {
    expect(buildCampaignRow(draft, { audienceId: 'aud-1' }, now, { asDraft: true }).status).toBe('rascunho');
  });
  it('coerces a sparse draft without throwing', () => {
    const row = buildCampaignRow({ tipo: 'texto' } as unknown as CampaignDraft, {}, now, { asDraft: true });
    expect(row.nome).toBe('');
    expect(row.mensagem).toBe('');
    expect(row.status).toBe('rascunho');
  });
  it('carries ad-hoc group_ids when provided', () => {
    const row = buildCampaignRow(draft, { groupIds: ['g1', 'g2'] }, now, { asDraft: false });
    expect(row.group_ids).toEqual(['g1', 'g2']);
  });
  it('normalizes empty group_ids to null', () => {
    const row = buildCampaignRow(draft, { groupIds: [] }, now, { asDraft: false });
    expect(row.group_ids).toBeNull();
  });
  it('defaults categoria to avulsas when absent/invalid', () => {
    expect(buildCampaignRow(draft, {}, now, { asDraft: false }).categoria).toBe('avulsas');
  });
  it('carries a valid categoria', () => {
    expect(buildCampaignRow({ ...draft, categoria: 'comunidade' }, {}, now, { asDraft: false }).categoria).toBe('comunidade');
  });

  // ── alvo: grupos vs. contatos ──────────────────────────────────────────────────
  it('defaults to alvo=grupos', () => {
    expect(buildCampaignRow(draft, {}, now, { asDraft: false }).alvo).toBe('grupos');
  });
  it('carries the chosen lists when alvo=contatos', () => {
    const row = buildCampaignRow(draft, { alvo: 'contatos', listIds: ['l1'] }, now, { asDraft: false });
    expect(row.alvo).toBe('contatos');
    expect(row.list_ids).toEqual(['l1']);
  });
  it('clears group targeting when alvo=contatos, so the target is never ambiguous', () => {
    const row = buildCampaignRow(
      draft,
      { alvo: 'contatos', listIds: ['l1'], audienceId: 'aud-1', groupIds: ['g1'] },
      now,
      { asDraft: false },
    );
    expect(row.audience_id).toBeNull();
    expect(row.group_ids).toBeNull();
  });
  it('clears list targeting when alvo=grupos', () => {
    const row = buildCampaignRow(draft, { alvo: 'grupos', listIds: ['l1'] }, now, { asDraft: false });
    expect(row.list_ids).toBeNull();
  });
  it('carries the chosen connection', () => {
    expect(buildCampaignRow(draft, { connectionId: 'c1' }, now, { asDraft: false }).connection_id).toBe('c1');
  });
});
