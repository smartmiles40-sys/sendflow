'use client';

// A tela "Automações" — o equivalente ao menu Automation do ManyChat, só WhatsApp.
//
// Os fluxos são o QUE acontece; os gatilhos são QUANDO acontece. As abas separam os
// gatilhos pelo jeito de a pessoa chegar (primeira mensagem, palavra, link, anúncio,
// formulário), porque é assim que a equipe pensa: "quem vier pela LP do Japão recebe…".

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Aviso, type DadosAutomacoes } from '@/components/automacoes/comum';
import { AbaFluxos } from '@/components/automacoes/AbaFluxos';
import { AbaBasicas } from '@/components/automacoes/AbaBasicas';
import { AbaPalavras } from '@/components/automacoes/AbaPalavras';
import { AbaLinks } from '@/components/automacoes/AbaLinks';
import { AbaWebhook } from '@/components/automacoes/AbaWebhook';
import { AbaCampos } from '@/components/automacoes/AbaCampos';
import { ABAS, type Aba } from './abas';




export function AutomacoesClient({ abaInicial }: { abaInicial: Aba }) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [dados, setDados] = useState<DadosAutomacoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const d = await api<DadosAutomacoes>('/api/fluxos');
      setDados({ fluxos: d.fluxos ?? [], gatilhos: d.gatilhos ?? [] });
      setErro(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(
        /fluxos|relation|schema cache/i.test(msg)
          ? 'As tabelas de automação ainda não existem no banco (migration 0020).'
          : msg,
      );
      setDados((atual) => atual ?? { fluxos: [], gatilhos: [] });
    }
  }, []);

  useEffect(() => {
    // Carregamento inicial dos dados da tela (padrão das outras páginas do sistema).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recarregar();
  }, [recarregar]);

  function trocarAba(nova: Aba) {
    setAba(nova);
    // A aba vai na URL para dar para mandar o link direto ("olha a aba Palavras-chave").
    router.replace(nova === 'fluxos' ? '/automacoes' : `/automacoes?aba=${nova}`, { scroll: false });
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Automações</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-muted">
          Conversas automáticas no WhatsApp oficial, do jeito do ManyChat: o <b className="text-ink">fluxo</b> é o que
          o robô responde; o <b className="text-ink">gatilho</b> é o que faz ele começar (uma palavra, a primeira
          mensagem, um link, um anúncio ou o formulário da LP).
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Seções das automações"
        className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto border-b border-border px-4 pb-px sm:mx-0 sm:px-0"
      >
        {ABAS.map((a) => {
          const ativa = a.id === aba;
          const qtd = contagem(a.id, dados);
          return (
            <button
              key={a.id}
              role="tab"
              type="button"
              aria-selected={ativa}
              onClick={() => trocarAba(a.id)}
              className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                ativa ? 'border-blue text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <span aria-hidden="true">{a.icone}</span>
              {a.label}
              {qtd !== null && qtd > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] ${ativa ? 'bg-blue/20 text-ink' : 'bg-surface2 text-muted'}`}>
                  {qtd}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {erro && (
        <div className="mb-5">
          <Aviso>{erro}</Aviso>
        </div>
      )}

      {!dados ? (
        <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">Carregando…</div>
      ) : (
        <div role="tabpanel">
          {aba === 'fluxos' && <AbaFluxos dados={dados} recarregar={recarregar} />}
          {aba === 'basicas' && <AbaBasicas dados={dados} recarregar={recarregar} />}
          {aba === 'palavras' && <AbaPalavras dados={dados} recarregar={recarregar} />}
          {aba === 'links' && <AbaLinks dados={dados} recarregar={recarregar} />}
          {aba === 'webhook' && <AbaWebhook dados={dados} recarregar={recarregar} />}
          {aba === 'campos' && <AbaCampos />}
        </div>
      )}
    </div>
  );
}

function contagem(aba: Aba, d: DadosAutomacoes | null): number | null {
  if (!d) return null;
  const g = (tipos: string[]) => d.gatilhos.filter((x) => tipos.includes(x.tipo)).length;
  switch (aba) {
    case 'fluxos':
      return d.fluxos.length;
    case 'palavras':
      return g(['palavra_chave']);
    case 'links':
      return g(['link_ref', 'anuncio']);
    case 'webhook':
      return g(['webhook', 'tag_adicionada']);
    default:
      return null;
  }
}
