'use client';

// E-mail → Conexão. Três passos, cada um liberando o próximo:
//
//   1. chave da API do Resend (vai para o cofre, nunca volta para a tela);
//   2. domínio de envio — o SendFlow cadastra no Resend e mostra os registros de DNS
//      para colar no painel do domínio, com o status de cada um;
//   3. webhook — criado sozinho no Resend, é o que traz entregue/bounce/spam.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { inputCls } from '@/components/ui';

interface Registro {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  status: string;
}

interface Estado {
  conectado: boolean;
  dominio: { id: string; name: string; status: string; records?: Registro[] } | null;
  dominios: { id: string; name: string; status: string }[];
  webhookPronto: boolean;
  urlWebhook: string;
  smtp: boolean;
  erro: string | null;
}

const STATUS: Record<string, { rotulo: string; cls: string }> = {
  verified: { rotulo: 'Verificado', cls: 'bg-green/10 text-[#D7F264]' },
  pending: { rotulo: 'Aguardando DNS', cls: 'bg-blue2/15 text-[#DFEFC5]' },
  not_started: { rotulo: 'Aguardando DNS', cls: 'bg-blue2/15 text-[#DFEFC5]' },
  failed: { rotulo: 'Falhou', cls: 'bg-orange/15 text-[#ffb183]' },
  temporary_failure: { rotulo: 'Falha temporária', cls: 'bg-orange/15 text-[#ffb183]' },
};

function Selo({ status }: { status: string }) {
  const s = STATUS[status] ?? { rotulo: status, cls: 'bg-muted/15 text-muted' };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{s.rotulo}</span>;
}

function Passo({
  n,
  titulo,
  feito,
  children,
}: {
  n: number;
  titulo: string;
  feito: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl2 border border-border bg-surface p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            feito ? 'bg-blue text-on-blue' : 'border border-border text-muted'
          }`}
          aria-hidden="true"
        >
          {feito ? '✓' : n}
        </span>
        <h2 className="text-[15px] font-semibold">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

const botao =
  'rounded-xl bg-blue px-4 py-3 text-[13px] font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted';
const botaoSec =
  'rounded-xl border border-border px-4 py-3 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:cursor-wait';

export function ConexaoEmailClient() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [chave, setChave] = useState('');
  const [dominio, setDominio] = useState('');
  const [segredo, setSegredo] = useState('');
  const [manual, setManual] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch('/api/email/conexao', { cache: 'no-store' });
    if (r.ok) setEstado((await r.json()) as Estado);
  }, []);

  useEffect(() => {
    let vivo = true;
    fetch('/api/email/conexao', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: Estado | null) => {
        if (vivo && b) setEstado(b);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  async function acao(corpo: Record<string, unknown>, rotulo: string) {
    setOcupado(rotulo);
    setErro(null);
    try {
      const r = await fetch('/api/email/conexao', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(b.error ?? 'Algo deu errado.');
        if (corpo.acao === 'webhook') setManual(true);
        return false;
      }
      await carregar();
      return true;
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function desconectar() {
    if (!window.confirm('Desconectar o Resend? Campanhas agendadas param de sair até conectar de novo.')) return;
    setOcupado('desconectar');
    await fetch('/api/email/conexao', { method: 'DELETE' }).catch(() => {});
    setOcupado(null);
    await carregar();
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
      setTimeout(() => setCopiado((c) => (c === texto ? null : c)), 1500);
    } catch {
      // Navegador sem permissão de área de transferência: o texto continua selecionável.
    }
  }

  if (!estado) return <p className="text-sm text-muted">Carregando a conexão…</p>;

  const dominioOk = estado.dominio?.status === 'verified';

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p role="alert" className="rounded-xl border border-orange/30 bg-orange/[0.08] p-3.5 text-sm leading-relaxed text-[#ffb183]">
          {erro}
        </p>
      )}
      {estado.erro && (
        <p role="alert" className="rounded-xl border border-orange/30 bg-orange/[0.08] p-3.5 text-sm leading-relaxed text-[#ffb183]">
          {estado.erro}
        </p>
      )}

      <Passo n={1} titulo="Chave da API do Resend" feito={estado.conectado}>
        {estado.conectado ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>🔐 Chave guardada no cofre.</span>
            <button type="button" onClick={() => void desconectar()} disabled={ocupado !== null} className="text-xs font-semibold underline underline-offset-2 hover:text-ink">
              Desconectar
            </button>
          </div>
        ) : (
          <>
            <p className="mb-3 max-w-2xl text-sm leading-relaxed text-muted">
              Em <b className="text-ink">resend.com → API Keys → Create API Key</b>, escolha a permissão{' '}
              <b className="text-ink">Full access</b> e cole aqui. Com ela o SendFlow cadastra o domínio e o webhook sozinho.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="password"
                value={chave}
                onChange={(e) => setChave(e.target.value.trim())}
                placeholder="re_…"
                autoComplete="off"
                aria-label="Chave da API do Resend"
                className={`${inputCls} min-w-[240px] flex-1`}
              />
              <button
                type="button"
                className={botao}
                disabled={!chave || ocupado !== null}
                onClick={() => void acao({ acao: 'conectar', chave }, 'conectar').then((ok) => ok && setChave(''))}
              >
                {ocupado === 'conectar' ? 'Conferindo…' : 'Conectar'}
              </button>
            </div>
          </>
        )}
      </Passo>

      <Passo n={2} titulo="Domínio de envio" feito={dominioOk}>
        {!estado.conectado ? (
          <p className="text-sm text-muted">Conecte a chave primeiro.</p>
        ) : (
          <>
            {!estado.dominio && (
              <p className="mb-3 max-w-2xl text-sm leading-relaxed text-muted">
                Use um <b className="text-ink">subdomínio só para marketing</b> (ex.: <code className="font-mono text-xs">mail.setuforeuvouviagens.com.br</code>):
                se uma campanha for mal, a reputação do domínio principal — o do e-mail do dia a dia — fica protegida.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <input
                value={dominio}
                onChange={(e) => setDominio(e.target.value.trim().toLowerCase())}
                placeholder={estado.dominio?.name ?? 'mail.suaempresa.com.br'}
                list="dominios-resend"
                aria-label="Domínio de envio"
                className={`${inputCls} min-w-[240px] flex-1`}
              />
              <datalist id="dominios-resend">
                {estado.dominios.map((d) => (
                  <option key={d.id} value={d.name} />
                ))}
              </datalist>
              <button
                type="button"
                className={botao}
                disabled={!dominio || ocupado !== null}
                onClick={() => void acao({ acao: 'dominio', dominio }, 'dominio').then((ok) => ok && setDominio(''))}
              >
                {ocupado === 'dominio' ? 'Cadastrando…' : estado.dominio ? 'Trocar domínio' : 'Usar este domínio'}
              </button>
            </div>

            {estado.dominio && (
              <div className="mt-5">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <b className="text-sm">{estado.dominio.name}</b>
                  <Selo status={estado.dominio.status} />
                  {!dominioOk && (
                    <button type="button" className={botaoSec} disabled={ocupado !== null} onClick={() => void acao({ acao: 'verificar' }, 'verificar')}>
                      {ocupado === 'verificar' ? 'Conferindo…' : 'Conferir DNS agora'}
                    </button>
                  )}
                </div>
                {!dominioOk && (
                  <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted">
                    Cole cada registro abaixo no painel onde o domínio está (Hostinger, Registro.br, Cloudflare…). A propagação leva de
                    minutos a algumas horas — depois clique em &quot;Conferir DNS agora&quot;.
                  </p>
                )}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-surface2 text-muted">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Tipo</th>
                        <th className="px-3 py-2 font-semibold">Nome</th>
                        <th className="px-3 py-2 font-semibold">Valor</th>
                        <th className="px-3 py-2 font-semibold">Prioridade</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(estado.dominio.records ?? []).map((r) => (
                        <tr key={`${r.type}-${r.name}-${r.value}`} className="border-t border-border align-top">
                          <td className="px-3 py-2.5 font-mono">{r.type}</td>
                          <td className="px-3 py-2.5">
                            <button type="button" onClick={() => void copiar(r.name)} className="break-all text-left font-mono hover:text-ink" title="Copiar">
                              {copiado === r.name ? 'Copiado ✓' : r.name}
                            </button>
                          </td>
                          <td className="max-w-[320px] px-3 py-2.5">
                            <button type="button" onClick={() => void copiar(r.value)} className="break-all text-left font-mono hover:text-ink" title="Copiar">
                              {copiado === r.value ? 'Copiado ✓' : r.value}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 font-mono">{r.priority ?? '—'}</td>
                          <td className="px-3 py-2.5">
                            <Selo status={r.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-muted">Toque no nome ou no valor para copiar.</p>
              </div>
            )}
          </>
        )}
      </Passo>

      <Passo n={3} titulo="Webhook (entregue, bounce e spam)" feito={estado.webhookPronto}>
        {!estado.conectado ? (
          <p className="text-sm text-muted">Conecte a chave primeiro.</p>
        ) : estado.webhookPronto ? (
          <p className="text-sm text-muted">
            ✓ O Resend avisa o SendFlow de cada entrega, bounce e denúncia de spam. Contato com bounce ou spam sai da base de envio sozinho.
          </p>
        ) : (
          <>
            <p className="mb-3 max-w-2xl text-sm leading-relaxed text-muted">
              Sem isso o SendFlow não sabe quem recebeu e continua mandando para endereço que não existe — o que derruba a
              reputação do domínio.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={botao} disabled={ocupado !== null} onClick={() => void acao({ acao: 'webhook' }, 'webhook')}>
                {ocupado === 'webhook' ? 'Criando…' : 'Criar o webhook no Resend'}
              </button>
              <button type="button" onClick={() => setManual((v) => !v)} className="text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink">
                Prefiro colar à mão
              </button>
            </div>
            {manual && (
              <div className="mt-4 rounded-xl border border-border bg-surface2/40 p-4 text-xs leading-relaxed text-muted">
                No Resend, em <b className="text-ink">Webhooks → Add Webhook</b>, cole este endereço e marque os eventos de e-mail
                (sent, delivered, delivery_delayed, bounced, complained):
                <button type="button" onClick={() => void copiar(estado.urlWebhook)} className="mt-2 block break-all font-mono text-ink">
                  {copiado === estado.urlWebhook ? 'Copiado ✓' : estado.urlWebhook}
                </button>
                <span className="mt-3 block">Depois copie o &quot;Signing secret&quot; dele e cole aqui:</span>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <input
                    type="password"
                    value={segredo}
                    onChange={(e) => setSegredo(e.target.value.trim())}
                    placeholder="whsec_…"
                    autoComplete="off"
                    aria-label="Signing secret do webhook"
                    className={`${inputCls} min-w-[240px] flex-1`}
                  />
                  <button
                    type="button"
                    className={botao}
                    disabled={!segredo || ocupado !== null}
                    onClick={() => void acao({ acao: 'segredo_webhook', segredo }, 'segredo').then((ok) => ok && setSegredo(''))}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Passo>

      <p className="text-xs leading-relaxed text-muted">
        Por último, confira o <b className="text-ink">remetente</b> em{' '}
        <Link href="/configuracoes" className="font-semibold text-blue2 underline-offset-2 hover:underline">
          Configurações
        </Link>
        : o e-mail do remetente precisa terminar no domínio verificado acima
        {estado.dominio ? (
          <>
            {' '}
            (ex.: <code className="font-mono">contato@{estado.dominio.name}</code>)
          </>
        ) : null}
        .
      </p>
    </div>
  );
}
