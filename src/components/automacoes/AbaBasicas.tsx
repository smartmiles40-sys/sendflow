'use client';

import { useState } from 'react';
import { Switch } from '@/components/ui';
import {
  api,
  Aviso,
  AvisoFluxoInativo,
  Cartao,
  selectCls,
  SeletorFluxo,
  type GatilhoLinha,
  type PropsAba,
} from './comum';

const INTERVALOS = [
  { horas: 0, rotulo: 'Toda vez' },
  { horas: 1, rotulo: 'No máximo 1x por hora' },
  { horas: 12, rotulo: 'No máximo 1x a cada 12 h' },
  { horas: 24, rotulo: 'No máximo 1x por dia' },
  { horas: 168, rotulo: 'No máximo 1x por semana' },
];

const ORDEM = [
  'Clique num botão de um fluxo',
  'Resposta a uma pergunta que o robô fez',
  'Link de referência (wa.me)',
  'Anúncio de clique para o WhatsApp',
  'Palavra-chave',
  'Boas-vindas (primeira mensagem da pessoa)',
  'Resposta padrão (nada acima casou)',
];

export function AbaBasicas({ dados, recarregar }: PropsAba) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr_320px]">
      <CartaoBasico
        tipo="boas_vindas"
        titulo="Mensagem de boas-vindas"
        icone="👋"
        explicacao="Roda na PRIMEIRA mensagem que uma pessoa manda para o número — uma vez na vida dela. Ideal para apresentar a agência e mostrar um menu em botões."
        dados={dados}
        recarregar={recarregar}
      />
      <CartaoBasico
        tipo="padrao"
        titulo="Resposta padrão"
        icone="🤖"
        explicacao="Roda quando a pessoa escreve algo que nenhuma palavra-chave entendeu. Limite a frequência para o robô não repetir a mesma frase a cada mensagem."
        dados={dados}
        recarregar={recarregar}
      />
      <Cartao className="xl:row-span-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">Quem responde primeiro</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Quando chega uma mensagem, o SendFlow testa nesta ordem e para no primeiro que casar:
        </p>
        <ol className="mt-3 space-y-1.5">
          {ORDEM.map((o, i) => (
            <li key={o} className="flex gap-2.5 text-[13px] text-[#C9DCD8]">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface2 text-[11px] font-semibold text-muted">
                {i + 1}
              </span>
              {o}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Conversa com a automação pausada (um atendente assumiu) ou contato que pediu para sair não recebe nada.
        </p>
      </Cartao>
    </div>
  );
}

function CartaoBasico({
  tipo,
  titulo,
  icone,
  explicacao,
  dados,
  recarregar,
}: PropsAba & { tipo: 'boas_vindas' | 'padrao'; titulo: string; icone: string; explicacao: string }) {
  const doTipo = dados.gatilhos.filter((g) => g.tipo === tipo);
  // Só um de cada tipo fica ligado (a API garante). Mostra o ligado, ou o mais recente.
  const atual: GatilhoLinha | undefined = doTipo.find((g) => g.ativo) ?? doTipo[0];
  const [fluxoNovo, setFluxoNovo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const fluxoEscolhido = atual?.fluxo_id ?? fluxoNovo;
  const intervalo = Number(atual?.config.intervalo_horas ?? 24);

  function escolherFluxo(id: string) {
    if (!atual) {
      setFluxoNovo(id);
      return;
    }
    if (id) void rodar(() => api(`/api/gatilhos/${atual.id}`, { method: 'PATCH', json: { fluxo_id: id } }));
  }

  function ligar(v: boolean) {
    if (atual) {
      void rodar(() => api(`/api/gatilhos/${atual.id}`, { method: 'PATCH', json: { ativo: v } }));
      return;
    }
    if (!fluxoNovo) {
      setErro('Escolha primeiro qual fluxo vai responder.');
      return;
    }
    void rodar(() =>
      api('/api/gatilhos', {
        method: 'POST',
        json: { fluxo_id: fluxoNovo, tipo, config: tipo === 'padrao' ? { intervalo_horas: 24 } : {}, ativo: v },
      }),
    );
  }

  return (
    <Cartao>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">
          {icone}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold leading-tight">{titulo}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{explicacao}</p>
        </div>
        <Switch checked={Boolean(atual?.ativo)} onChange={ligar} label={`Ligar ${titulo}`} />
      </div>

      <div className="mt-4">
        <label className="mb-2 block text-[13px] font-semibold" htmlFor={`fluxo-${tipo}`}>
          Fluxo que responde
        </label>
        <SeletorFluxo id={`fluxo-${tipo}`} fluxos={dados.fluxos} valor={fluxoEscolhido} onChange={escolherFluxo} />
        {atual && <AvisoFluxoInativo g={atual} />}
      </div>

      {tipo === 'padrao' && (
        <div className="mt-4">
          <label className="mb-2 block text-[13px] font-semibold" htmlFor="intervalo-padrao">
            Frequência
          </label>
          <select
            id="intervalo-padrao"
            value={intervalo}
            disabled={!atual || ocupado}
            onChange={(e) =>
              atual &&
              void rodar(() =>
                api(`/api/gatilhos/${atual.id}`, { method: 'PATCH', json: { config: { intervalo_horas: Number(e.target.value) } } }),
              )
            }
            className={selectCls}
          >
            {INTERVALOS.map((i) => (
              <option key={i.horas} value={i.horas}>
                {i.rotulo}
              </option>
            ))}
          </select>
          {!atual && <p className="mt-1 text-[12px] text-muted">Ligue a resposta padrão para escolher a frequência.</p>}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-[12.5px] text-muted">
        <span>
          {atual ? (
            <>
              Disparou <b className="text-ink">{atual.disparos}</b> {atual.disparos === 1 ? 'vez' : 'vezes'}
            </>
          ) : (
            'Ainda não configurado'
          )}
        </span>
        {ocupado && <span>Salvando…</span>}
      </div>
      {erro && (
        <div className="mt-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}
    </Cartao>
  );
}
