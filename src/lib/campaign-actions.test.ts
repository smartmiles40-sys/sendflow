import { describe, it, expect } from 'vitest';
import { campaignActions } from './campaign-actions';

describe('campaignActions', () => {
  it('agendada → editar, cancelar, excluir', () => {
    expect(campaignActions('agendada')).toEqual(['editar', 'cancelar', 'excluir']);
  });
  it('rascunho → editar, excluir', () => {
    expect(campaignActions('rascunho')).toEqual(['editar', 'excluir']);
  });
  it('erro → reenviar, editar, excluir', () => {
    expect(campaignActions('erro')).toEqual(['reenviar', 'editar', 'excluir']);
  });
  it('cancelada → reenviar, excluir', () => {
    expect(campaignActions('cancelada')).toEqual(['reenviar', 'excluir']);
  });
  it('enviada → excluir only', () => {
    expect(campaignActions('enviada')).toEqual(['excluir']);
  });
  it('enviando → só cancelar (interromper o disparo em andamento)', () => {
    expect(campaignActions('enviando')).toEqual(['cancelar']);
  });
});
