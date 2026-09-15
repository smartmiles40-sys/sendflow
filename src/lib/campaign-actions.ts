import type { CampaignStatus } from './types';

// Ações disponíveis em cada linha do painel de campanhas, por status. Lógica pura,
// testável e reusada pela linha da tabela. A ordem aqui é a ordem exibida.
//
// `enviando` permite APENAS cancelar: com o motor mandando de 8 em 8 segundos, uma
// campanha grande fica minutos em envio, e interromper é a única forma de conter um
// texto errado que já começou a sair. Editar continua bloqueado — trocar a mensagem no
// meio faria metade dos grupos receber uma coisa e metade outra.
export type CampaignAction = 'reenviar' | 'editar' | 'cancelar' | 'excluir';

const byStatus: Record<CampaignStatus, CampaignAction[]> = {
  agendada: ['editar', 'cancelar', 'excluir'],
  rascunho: ['editar', 'excluir'],
  erro: ['reenviar', 'editar', 'excluir'],
  cancelada: ['reenviar', 'excluir'],
  enviada: ['excluir'],
  enviando: ['cancelar'],
};

export function campaignActions(status: CampaignStatus): CampaignAction[] {
  return byStatus[status] ?? [];
}
