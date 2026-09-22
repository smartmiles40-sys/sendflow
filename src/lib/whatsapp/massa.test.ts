import { describe, it, expect } from 'vitest';
import { ehPedidoDeParada, limparParametro, preverTemplate, resolverVariaveis } from './massa';

describe('limparParametro', () => {
  it('tira quebra de linha e tabulação, que a Meta recusa com 132012', () => {
    expect(limparParametro('Maria\nSilva\tSantos')).toBe('Maria Silva Santos');
  });
  it('corta sequências de 4+ espaços', () => {
    expect(limparParametro('Maria        Silva')).toBe('Maria   Silva');
  });
  it('não quebra com nulo', () => {
    expect(limparParametro(undefined as unknown as string)).toBe('');
  });
});

describe('resolverVariaveis', () => {
  const contato = {
    nome: 'Maria Silva Santos',
    email: 'maria@exemplo.com',
    empresa: 'Se Tu For',
    campos: { cidade: 'Belo Horizonte' },
  };

  it('resolve o dialeto do sistema dentro da posição da Meta', () => {
    const valores = resolverVariaveis({ '1': '{{primeiro_nome}}', '2': 'Japão & China' }, contato);
    expect(valores).toEqual(['Maria', 'Japão & China']);
  });

  it('ordena por posição NUMÉRICA, não pela ordem do objeto', () => {
    const valores = resolverVariaveis({ '10': 'dez', '2': 'dois', '1': 'um' }, contato);
    expect(valores[0]).toBe('um');
    expect(valores[1]).toBe('dois');
    expect(valores[9]).toBe('dez');
  });

  it('completa posição faltante com vazio — a Meta conta posições, não preenchidas', () => {
    const valores = resolverVariaveis({ '1': 'um', '3': 'três' }, contato, 3);
    expect(valores).toEqual(['um', '', 'três']);
  });

  it('respeita a quantidade que o template pede, mesmo com mapa maior', () => {
    expect(resolverVariaveis({ '1': 'a', '2': 'b', '3': 'c' }, contato, 2)).toHaveLength(2);
  });

  it('campo livre do CSV também vale', () => {
    expect(resolverVariaveis({ '1': '{{cidade}}' }, contato)).toEqual(['Belo Horizonte']);
  });

  it('variável desconhecida some em vez de aparecer crua para o cliente', () => {
    expect(resolverVariaveis({ '1': 'Olá {{plano}}' }, contato)).toEqual(['Olá']);
  });

  it('mapa vazio não gera parâmetro nenhum', () => {
    expect(resolverVariaveis(null, contato)).toEqual([]);
  });

  it('contato sem e-mail não quebra (WhatsApp não exige e-mail)', () => {
    expect(resolverVariaveis({ '1': '{{primeiro_nome}}' }, { nome: 'João' })).toEqual(['João']);
  });
});

describe('preverTemplate', () => {
  it('mostra o texto final que a pessoa vai ver', () => {
    expect(preverTemplate('Oi {{1}}, a turma do {{2}} abriu!', ['Maria', 'Japão'])).toBe(
      'Oi Maria, a turma do Japão abriu!',
    );
  });
  it('posição sem valor fica como veio, para a falha ser visível na prévia', () => {
    expect(preverTemplate('Oi {{1}} e {{2}}', ['Maria'])).toBe('Oi Maria e {{2}}');
  });
});

describe('ehPedidoDeParada', () => {
  it.each(['PARAR', 'parar', 'Sair', 'cancelar', 'STOP', 'descadastrar', 'me remova'])(
    'reconhece "%s"',
    (texto) => {
      expect(ehPedidoDeParada(texto)).toBe(true);
    },
  );

  it('aceita acento e pontuação', () => {
    expect(ehPedidoDeParada('Não quero!')).toBe(true);
  });

  it('aceita o pedido com complemento curto', () => {
    expect(ehPedidoDeParada('parar de receber')).toBe(true);
  });

  it('NÃO descadastra quem só usou a palavra no meio de uma frase', () => {
    expect(ehPedidoDeParada('não quero perder a data, me manda o link por favor')).toBe(false);
  });

  it('NÃO descadastra uma resposta comum', () => {
    expect(ehPedidoDeParada('Oi! Quero saber mais sobre o Japão')).toBe(false);
  });

  it('mensagem vazia não é pedido de saída', () => {
    expect(ehPedidoDeParada('')).toBe(false);
  });
});
