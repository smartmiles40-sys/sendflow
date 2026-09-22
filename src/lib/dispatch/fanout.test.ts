import { describe, it, expect } from 'vitest';
import { gruposDaCampanha, montarDestinatarios, montarLinhasDeContatos, resumirFila } from './fanout';
import type { Audience, Campaign, Contact, Group } from '../types';

function grupo(p: Partial<Group>): Group {
  return { id: 'g', group_id: '1@g.us', nome: 'Grupo', ativo: true, criado_em: '', ...p };
}

function campanha(p: Partial<Campaign>): Campaign {
  return {
    id: 'c1',
    nome: 'Teste',
    tipo: 'texto',
    categoria: 'avulsas',
    mensagem: 'oi',
    midia_url: null,
    mencionar_todos: false,
    audience_id: null,
    group_ids: null,
    alvo: 'grupos',
    list_ids: null,
    connection_id: null,
    enviar_em: null,
    status: 'agendada',
    resultado: null,
    enviado_em: null,
    criado_em: '',
    atualizado_em: '',
    ...p,
  };
}

function contato(p: Partial<Contact>): Contact {
  return {
    id: 'ct1',
    nome: 'Maria',
    email: null,
    telefone: '5511999998888',
    empresa: null,
    tags: [],
    status_email: 'ativo',
    status_whatsapp: 'ativo',
    origem: null,
    campos: {},
    descadastrado_em: null,
    criado_em: '',
    atualizado_em: '',
    ...p,
  };
}

const semFontes = { grupos: [], audience: null, contatos: [], conexaoPadrao: null };

describe('gruposDaCampanha — precedência do público', () => {
  const g1 = grupo({ id: 'a', group_id: '1@g.us', nome: 'Um' });
  const g2 = grupo({ id: 'b', group_id: '2@g.us', nome: 'Dois' });

  it('sem seleção, vai para todos os grupos ativos', () => {
    expect(gruposDaCampanha(campanha({}), [g1, g2], null)).toHaveLength(2);
  });

  it('group_ids da campanha manda em tudo', () => {
    const r = gruposDaCampanha(campanha({ group_ids: ['2@g.us'] }), [g1, g2], null);
    expect(r.map((g) => g.group_id)).toEqual(['2@g.us']);
  });

  it('público manual vale quando não há group_ids', () => {
    const aud: Audience = { id: 'p', nome: 'P', tipo: 'manual', group_ids: ['1@g.us'], criado_em: '' };
    const r = gruposDaCampanha(campanha({ audience_id: 'p' }), [g1, g2], aud);
    expect(r.map((g) => g.group_id)).toEqual(['1@g.us']);
  });

  it('público "todos" não filtra nada', () => {
    const aud: Audience = { id: 'p', nome: 'P', tipo: 'todos', group_ids: null, criado_em: '' };
    expect(gruposDaCampanha(campanha({ audience_id: 'p' }), [g1, g2], aud)).toHaveLength(2);
  });

  it('group_ids ganha do público salvo quando os dois existem', () => {
    const aud: Audience = { id: 'p', nome: 'P', tipo: 'manual', group_ids: ['1@g.us'], criado_em: '' };
    const r = gruposDaCampanha(campanha({ group_ids: ['2@g.us'], audience_id: 'p' }), [g1, g2], aud);
    expect(r.map((g) => g.group_id)).toEqual(['2@g.us']);
  });

  it('grupo escolhido que saiu do cadastro ainda é enviado, não some em silêncio', () => {
    const r = gruposDaCampanha(campanha({ group_ids: ['99@g.us'] }), [g1], null);
    expect(r.map((g) => g.group_id)).toEqual(['99@g.us']);
  });
});

describe('montarDestinatarios — grupos', () => {
  it('monta uma linha por grupo', () => {
    const { linhas } = montarDestinatarios(campanha({}), {
      ...semFontes,
      grupos: [grupo({ group_id: '1@g.us', nome: 'Um' }), grupo({ id: 'b', group_id: '2@g.us' })],
    });
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ destino: '1@g.us', destino_tipo: 'grupo', status: 'pendente' });
  });

  it('o mesmo grupo nos dois dialetos vira UM destinatário', () => {
    // Sem isso, o grupo receberia a mesma mensagem duas vezes — e quem está lá dentro vê.
    const { linhas } = montarDestinatarios(
      campanha({ group_ids: ['120@g.us', '120-group'] }),
      semFontes,
    );
    expect(linhas).toHaveLength(1);
  });

  it('a conexão do GRUPO ganha da conexão da campanha', () => {
    // É o que faz o disparo se distribuir entre vários números sozinho: um grupo só
    // pode ser alcançado pelo número que participa dele.
    const { linhas } = montarDestinatarios(campanha({ connection_id: 'da-campanha' }), {
      ...semFontes,
      grupos: [grupo({ connection_id: 'do-grupo' })],
    });
    expect(linhas[0].connection_id).toBe('do-grupo');
  });

  it('sem conexão no grupo, usa a da campanha', () => {
    const { linhas } = montarDestinatarios(campanha({ connection_id: 'da-campanha' }), {
      ...semFontes,
      grupos: [grupo({ connection_id: null })],
    });
    expect(linhas[0].connection_id).toBe('da-campanha');
  });

  it('sem nenhuma das duas, cai na conexão padrão', () => {
    const { linhas } = montarDestinatarios(campanha({}), {
      ...semFontes,
      grupos: [grupo({ connection_id: null })],
      conexaoPadrao: 'padrao',
    });
    expect(linhas[0].connection_id).toBe('padrao');
  });

  it('ID de grupo inválido é ignorado COM aviso', () => {
    const r = montarDestinatarios(campanha({ group_ids: ['   '] }), semFontes);
    expect(r.linhas).toHaveLength(0);
    expect(r.avisos.length).toBeGreaterThan(0);
  });

  it('nenhum grupo válido devolve aviso em vez de fila vazia silenciosa', () => {
    const r = montarDestinatarios(campanha({}), semFontes);
    expect(r.linhas).toHaveLength(0);
    expect(r.avisos[0]).toMatch(/Nenhum grupo/);
  });
});

describe('montarDestinatarios — contatos', () => {
  const paraContatos = campanha({ alvo: 'contatos', list_ids: ['l1'] });

  it('monta uma linha por contato, com o telefone normalizado', () => {
    const { linhas } = montarDestinatarios(paraContatos, {
      ...semFontes,
      contatos: [contato({ telefone: '11999998888' })],
      conexaoPadrao: 'c1',
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      destino: '5511999998888',
      destino_tipo: 'contato',
      contact_id: 'ct1',
      connection_id: 'c1',
    });
  });

  it('quem descadastrou do WhatsApp fica de fora', () => {
    const { linhas } = montarDestinatarios(paraContatos, {
      ...semFontes,
      contatos: [contato({ status_whatsapp: 'descadastrado' })],
    });
    expect(linhas).toHaveLength(0);
  });

  it('telefone inválido é ignorado com aviso', () => {
    const r = montarDestinatarios(paraContatos, {
      ...semFontes,
      contatos: [contato({ telefone: '123' })],
    });
    expect(r.linhas).toHaveLength(0);
    expect(r.avisos.some((a) => a.includes('inválido'))).toBe(true);
  });

  it('a mesma pessoa em duas listas recebe uma vez só', () => {
    const { linhas } = montarDestinatarios(paraContatos, {
      ...semFontes,
      contatos: [contato({ id: 'a' }), contato({ id: 'b' })],
    });
    expect(linhas).toHaveLength(1);
  });
});

describe('resumirFila', () => {
  it('conta enviados cumulativamente (lido também foi enviado)', () => {
    const r = resumirFila([
      { status: 'enviado' },
      { status: 'entregue' },
      { status: 'lido' },
      { status: 'falha' },
      { status: 'pendente' },
    ]);
    expect(r).toEqual({ total: 5, enviados: 3, falhas: 1, pendentes: 1 });
  });
});


describe('montarLinhasDeContatos — o fan-out em fatias do disparo em massa', () => {
  const massa = campanha({
    alvo: 'contatos',
    connection_id: 'cloud-1',
    template_nome: 'live_japao',
    template_variaveis: { '1': '{{primeiro_nome}}', '2': 'Japão & China' },
  });

  it('resolve as variáveis do template para CADA pessoa', () => {
    const { linhas } = montarLinhasDeContatos(
      massa,
      [contato({ id: 'a', nome: 'Maria Silva', telefone: '11999998888' })],
      'cloud-1',
      { variaveisDoTemplate: 2 },
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].variaveis).toEqual({ '1': 'Maria', '2': 'Japão & China' });
    expect(linhas[0].destino).toBe('5511999998888');
    expect(linhas[0].connection_id).toBe('cloud-1');
    expect(linhas[0].destino_tipo).toBe('contato');
  });

  it('deixa de fora quem pediu para sair — insistir derruba a qualidade do número', () => {
    const { linhas, ignorados } = montarLinhasDeContatos(
      massa,
      [
        contato({ id: 'a', telefone: '11999998888' }),
        contato({ id: 'b', telefone: '11988887777', status_whatsapp: 'descadastrado' }),
      ],
      'cloud-1',
      { variaveisDoTemplate: 2 },
    );
    expect(linhas).toHaveLength(1);
    expect(ignorados).toBe(1);
  });

  it('a mesma pessoa em duas listas entra uma vez só, mesmo entre páginas', () => {
    const vistos = new Set<string>();
    const pagina1 = montarLinhasDeContatos(massa, [contato({ id: 'a', telefone: '11999998888' })], 'c', {
      variaveisDoTemplate: 2,
      vistos,
    });
    const pagina2 = montarLinhasDeContatos(massa, [contato({ id: 'b', telefone: '11999998888' })], 'c', {
      variaveisDoTemplate: 2,
      vistos,
    });
    expect(pagina1.linhas).toHaveLength(1);
    expect(pagina2.linhas).toHaveLength(0);
    expect(pagina2.ignorados).toBe(1);
  });

  it('telefone inválido é ignorado em vez de virar linha que falha na Meta', () => {
    const { linhas, ignorados } = montarLinhasDeContatos(
      massa,
      [contato({ id: 'a', telefone: '123' })],
      'cloud-1',
    );
    expect(linhas).toHaveLength(0);
    expect(ignorados).toBe(1);
  });

  it('campanha sem template não gera variáveis', () => {
    const semTemplate = campanha({ alvo: 'contatos', template_variaveis: null });
    const { linhas } = montarLinhasDeContatos(semTemplate, [contato({ id: 'a' })], 'c');
    expect(linhas[0].variaveis).toBeNull();
  });

  it('respeita a quantidade de variáveis que o template pede', () => {
    const { linhas } = montarLinhasDeContatos(massa, [contato({ id: 'a' })], 'c', {
      variaveisDoTemplate: 1,
    });
    expect(Object.keys(linhas[0].variaveis ?? {})).toEqual(['1']);
  });
});
