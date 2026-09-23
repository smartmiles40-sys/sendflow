'use client';

import { useState } from 'react';
import { Field, inputCls, Switch } from '@/components/ui';
import {
  api,
  ApagarInline,
  Aviso,
  AvisoFluxoInativo,
  btnPequeno,
  btnPrimario,
  btnSecundario,
  CampoCopiavel,
  Cartao,
  Chip,
  Copiar,
  SeletorFluxo,
  Vazio,
  type GatilhoLinha,
  type PropsAba,
} from './comum';

const EXEMPLO = {
  telefone: '11999998888',
  nome: 'Maria Silva',
  email: 'maria@email.com',
  tags: ['lead-lp-japao'],
  campos: { destino_interesse: 'Japão' },
};

export function AbaWebhook({ dados, recarregar }: PropsAba) {
  return (
    <div className="flex flex-col gap-8">
      <SecaoWebhook dados={dados} recarregar={recarregar} />
      <SecaoTag dados={dados} recarregar={recarregar} />
    </div>
  );
}

function useRodar(recarregar: () => Promise<void>) {
  const [erro, setErro] = useState<string | null>(null);
  async function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }
  return { erro, rodar };
}

// ── Webhook externo ──────────────────────────────────────────────────────────────

function SecaoWebhook({ dados, recarregar }: PropsAba) {
  const lista = dados.gatilhos.filter((g) => g.tipo === 'webhook');
  const [criando, setCriando] = useState(false);
  const [fluxoNovo, setFluxoNovo] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const { erro, rodar } = useRodar(recarregar);
  const origem = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">🪝 Webhook — formulário da LP, n8n, Bitrix</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">
            Um endereço secreto que qualquer sistema pode chamar para começar um fluxo para um telefone. Exemplo: o
            formulário da LP do Japão manda o lead para cá e o SendFlow dispara as boas-vindas no WhatsApp na hora.
          </p>
        </div>
        {!criando && (
          <button type="button" onClick={() => setCriando(true)} className={`${btnPrimario} w-full sm:w-auto`}>
            + Novo webhook
          </button>
        )}
      </div>

      <div className="mb-3">
        <Aviso tom="info">
          <b>Importante:</b> quem chega por webhook quase nunca conversou com o número nas últimas 24 h. Por regra da Meta,
          a primeira mensagem precisa ser um <b>template aprovado</b> — comece o fluxo com um bloco <b>Template</b>. Texto
          livre só depois que a pessoa responder.
        </Aviso>
      </div>
      {erro && (
        <div className="mb-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}

      {criando && (
        <Cartao className="mb-3 border-blue2/40">
          <Field label="Fluxo que começa">
            <SeletorFluxo fluxos={dados.fluxos} valor={fluxoNovo} onChange={setFluxoNovo} />
          </Field>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={!fluxoNovo}
              onClick={() =>
                void rodar(async () => {
                  const r = await api<{ gatilho: GatilhoLinha }>('/api/gatilhos', {
                    method: 'POST',
                    json: { tipo: 'webhook', fluxo_id: fluxoNovo, config: {} },
                  });
                  setCriando(false);
                  setFluxoNovo('');
                  setAberto(r.gatilho.id);
                })
              }
              className={`${btnPrimario} flex-1 sm:flex-none`}
            >
              Gerar endereço
            </button>
            <button type="button" onClick={() => setCriando(false)} className={btnSecundario}>
              Cancelar
            </button>
          </div>
        </Cartao>
      )}

      {lista.length === 0 && !criando ? (
        <Vazio>Nenhum webhook ainda. O modelo &quot;Sequência para lead da LP&quot; já vem pronto para usar com um.</Vazio>
      ) : (
        <div className="flex flex-col gap-3">
          {lista.map((g) => {
            const url = `${origem}/api/webhooks/fluxo/${g.config.token ?? ''}`;
            const curl = `curl -X POST '${url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(EXEMPLO)}'`;
            return (
              <Cartao key={g.id} className={g.ativo ? '' : 'opacity-70'}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink">→ {g.fluxos?.nome ?? 'fluxo apagado'}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {g.disparos} {g.disparos === 1 ? 'chamada' : 'chamadas'} recebidas
                    </p>
                    <AvisoFluxoInativo g={g} />
                  </div>
                  <Switch
                    checked={g.ativo}
                    onChange={(v) => void rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { ativo: v } }))}
                    label="Ligar webhook"
                  />
                </div>
                <div className="mt-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Endereço (POST)</p>
                  <CampoCopiavel valor={url} />
                  <p className="mt-1 text-[11.5px] text-muted">Trate como senha: quem tem o endereço consegue disparar o fluxo.</p>
                </div>
                {aberto === g.id ? (
                  <div className="mt-3 flex flex-col gap-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Corpo (JSON)</p>
                        <Copiar texto={JSON.stringify(EXEMPLO, null, 2)} />
                      </div>
                      <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-[#C9DCD8]">
                        {JSON.stringify(EXEMPLO, null, 2)}
                      </pre>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                        Só <code className="font-mono">telefone</code> é obrigatório (com ou sem 55). <code className="font-mono">tags</code> e{' '}
                        <code className="font-mono">campos</code> entram no contato antes do fluxo rodar — dá para usar{' '}
                        <code className="font-mono">{'{{destino_interesse}}'}</code> no template.
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Teste pelo terminal</p>
                        <Copiar texto={curl} />
                      </div>
                      <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-[#C9DCD8]">
                        {curl}
                      </pre>
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => setAberto(aberto === g.id ? null : g.id)} className={btnPequeno}>
                    {aberto === g.id ? 'Esconder exemplo' : 'Ver exemplo de uso'}
                  </button>
                  <ApagarInline onConfirmar={() => rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'DELETE' }))} />
                </div>
              </Cartao>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Tag adicionada ───────────────────────────────────────────────────────────────

function SecaoTag({ dados, recarregar }: PropsAba) {
  const lista = dados.gatilhos.filter((g) => g.tipo === 'tag_adicionada');
  const [criando, setCriando] = useState(false);
  const [tag, setTag] = useState('');
  const [fluxoId, setFluxoId] = useState('');
  const { erro, rodar } = useRodar(recarregar);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">🏷️ Quando uma tag é adicionada</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">
            Encadeia automações: quando um fluxo (ou alguém na caixa de conversa, via fluxo) põe a tag{' '}
            <b className="text-ink">lead-quente</b> no contato, outro fluxo começa sozinho.
          </p>
        </div>
        {!criando && (
          <button type="button" onClick={() => setCriando(true)} className={`${btnPrimario} w-full sm:w-auto`}>
            + Nova regra de tag
          </button>
        )}
      </div>
      {erro && (
        <div className="mb-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}
      {criando && (
        <Cartao className="mb-3 border-blue2/40">
          <Field label="Tag">
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="lead-quente" className={inputCls} autoFocus />
          </Field>
          <Field label="Fluxo que começa">
            <SeletorFluxo fluxos={dados.fluxos} valor={fluxoId} onChange={setFluxoId} />
          </Field>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={!tag.trim() || !fluxoId}
              onClick={() =>
                void rodar(async () => {
                  await api('/api/gatilhos', { method: 'POST', json: { tipo: 'tag_adicionada', fluxo_id: fluxoId, config: { tag: tag.trim() } } });
                  setCriando(false);
                  setTag('');
                  setFluxoId('');
                })
              }
              className={`${btnPrimario} flex-1 sm:flex-none`}
            >
              Salvar
            </button>
            <button type="button" onClick={() => setCriando(false)} className={btnSecundario}>
              Cancelar
            </button>
          </div>
        </Cartao>
      )}
      {lista.length === 0 && !criando ? (
        <Vazio>Nenhuma regra de tag.</Vazio>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {lista.map((g) => (
            <li key={g.id} className={`flex flex-wrap items-center gap-3 rounded-xl2 border border-border bg-surface p-4 ${g.ativo ? '' : 'opacity-70'}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px]">
                  <Chip>{g.config.tag}</Chip> <span className="text-muted">→</span>{' '}
                  <b className="text-ink">{g.fluxos?.nome ?? 'fluxo apagado'}</b>
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {g.disparos} {g.disparos === 1 ? 'disparo' : 'disparos'}
                </p>
                <AvisoFluxoInativo g={g} />
              </div>
              <Switch
                checked={g.ativo}
                onChange={(v) => void rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { ativo: v } }))}
                label="Ligar regra de tag"
              />
              <ApagarInline onConfirmar={() => rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'DELETE' }))} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
