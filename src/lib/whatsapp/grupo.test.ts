import { describe, it, expect } from 'vitest';
import {
  digitosDoJid,
  explicarStatusParticipante,
  meuPapel,
  paraInfoGrupo,
  paraParticipante,
} from './grupo';

describe('paraParticipante', () => {
  it('participante por telefone: o telefone sai do próprio id', () => {
    const p = paraParticipante({ id: '5511999999999@s.whatsapp.net', admin: 'admin', name: 'Ana' });
    expect(p).toEqual({ jid: '5511999999999@s.whatsapp.net', telefone: '5511999999999', nome: 'Ana', foto: null, papel: 'admin' });
  });

  it('participante por LID: o telefone vem em phoneNumber, e o id continua o LID', () => {
    const p = paraParticipante({ id: '123456@lid', phoneNumber: '5521988887777@s.whatsapp.net', admin: 'superadmin' });
    expect(p?.jid).toBe('123456@lid');
    expect(p?.telefone).toBe('5521988887777');
    expect(p?.papel).toBe('dono');
  });

  it('LID sem telefone: telefone nulo (não inventa)', () => {
    expect(paraParticipante({ id: '123456@lid' })?.telefone).toBeNull();
  });

  it('sem id não vira participante', () => {
    expect(paraParticipante({ name: 'x' })).toBeNull();
  });
});

describe('digitosDoJid', () => {
  it('tira o sufixo de aparelho (":12")', () => {
    expect(digitosDoJid('5511999999999:12@s.whatsapp.net')).toBe('5511999999999');
  });
  it('LID não é telefone', () => {
    expect(digitosDoJid('123@lid')).toBeNull();
  });
});

describe('meuPapel', () => {
  const lista = [
    { jid: 'a@s.whatsapp.net', telefone: '551130000000', nome: null, foto: null, papel: 'admin' as const },
    { jid: 'b@s.whatsapp.net', telefone: '551140000000', nome: null, foto: null, papel: null },
  ];
  it('acha o número conectado pelo telefone', () => {
    expect(meuPapel(lista, '+55 11 3000-0000')).toBe('admin');
    expect(meuPapel(lista, '551140000000')).toBe('membro');
  });
  it('não achou e há LID sem telefone: "não sei" (null), não "membro"', () => {
    const comLid = [...lista, { jid: 'x@lid', telefone: null, nome: null, foto: null, papel: 'dono' as const }];
    expect(meuPapel(comLid, '551150000000')).toBeNull();
  });
  it('sem número da conexão: null', () => {
    expect(meuPapel(lista, null)).toBeNull();
  });
});

describe('paraInfoGrupo', () => {
  it('lê as regras e ordena admins primeiro', () => {
    const info = paraInfoGrupo(
      { id: '1@g.us', subject: 'Live Peru', desc: 'regras', announce: true, restrict: false, size: 3, creation: 1700000000 },
      [
        { id: '3@s.whatsapp.net', name: 'Zé' },
        { id: '1@s.whatsapp.net', name: 'Bia', admin: 'admin' },
        { id: '2@s.whatsapp.net', name: 'Ana', admin: 'superadmin' },
      ],
      '1',
    );
    expect(info.nome).toBe('Live Peru');
    expect(info.soAdminsEnviam).toBe(true);
    expect(info.soAdminsEditam).toBe(false);
    expect(info.participantes.map((p) => p.nome)).toEqual(['Ana', 'Bia', 'Zé']);
    expect(info.meuPapel).toBe('admin');
  });

  it('sem a lista rica de participantes, usa a do findGroupInfos', () => {
    const info = paraInfoGrupo({ id: '1@g.us', participants: [{ id: '9@s.whatsapp.net' }] }, [], null);
    expect(info.participantes).toHaveLength(1);
    expect(info.total).toBe(1);
  });
});

describe('explicarStatusParticipante', () => {
  it('200 é sucesso (sem mensagem)', () => {
    expect(explicarStatusParticipante('200', 'add')).toBeNull();
  });
  it('403 ao adicionar = privacidade: sugere o link', () => {
    expect(explicarStatusParticipante('403', 'add')).toMatch(/link/);
  });
  it('409 ao adicionar = já está no grupo', () => {
    expect(explicarStatusParticipante('409', 'add')).toBe('já está no grupo');
  });
});
