'use client';

// Conectar o Instagram. Duas coisas moram no painel da Meta e só lá podem ser feitas
// (endereço de retorno do login e tester do app) — a tela mostra exatamente o que
// colar e onde. O resto (token, cofre, webhook) o SendFlow faz sozinho.

import { useState } from 'react';
import { inputCls } from '@/components/ui';

export interface ContaIg {
  id: string;
  ig_user_id: string;
  username: string | null;
  nome: string | null;
  foto_url: string | null;
  status: string;
  token_expira_em: string | null;
  webhook_assinado_em: string | null;
  ultima_entrada_em: string | null;
  ultimo_erro: string | null;
}

export interface ConfigIg {
  appId: string | null;
  temSegredo: boolean;
  urlRetorno: string;
  urlWebhook: string;
  verifyToken: string | null;
  metaConfigurada: boolean;
  contas: ContaIg[];
}

function Copiavel({ valor, copiado, onCopiar }: { valor: string; copiado: string | null; onCopiar: (v: string) => void }) {
  return (
    <button type="button" onClick={() => onCopiar(valor)} className="block break-all text-left font-mono text-ink hover:underline" title="Copiar">
      {copiado === valor ? 'Copiado ✓' : valor}
    </button>
  );
}

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

export function ConexaoInstagram({ cfg, onMudou }: { cfg: ConfigIg; onMudou: () => void }) {
  const [appId, setAppId] = useState(cfg.appId ?? '');
  const [segredo, setSegredo] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const pronto = Boolean(cfg.appId && cfg.temSegredo);

  async function copiar(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      setCopiado(t);
      setTimeout(() => setCopiado((c) => (c === t ? null : c)), 1500);
    } catch {
      // sem permissão de área de transferência: o texto continua selecionável
    }
  }

  async function salvar() {
    setOcupado('salvar');
    setErro(null);
    setOk(null);
    try {
      const r = await fetch('/api/instagram/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId, ...(segredo ? { appSecret: segredo } : {}) }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(b.error ?? 'Não consegui salvar.');
      setSegredo('');
      setOk('Salvo.');
      onMudou();
    } finally {
      setOcupado(null);
    }
  }

  async function acaoConta(id: string, metodo: 'POST' | 'DELETE') {
    if (metodo === 'DELETE' && !window.confirm('Desconectar esta conta? As automações param até conectar de novo.')) return;
    setOcupado(id);
    setErro(null);
    setOk(null);
    try {
      const r = await fetch(`/api/instagram/contas/${id}`, {
        method: metodo,
        headers: { 'content-type': 'application/json' },
        body: metodo === 'POST' ? JSON.stringify({ acao: 'webhook' }) : undefined,
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) return setErro(b.error ?? 'A Meta recusou.');
      setOk(metodo === 'POST' ? 'Webhooks reassinados. Comente num post para testar.' : 'Conta desconectada.');
      onMudou();
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p role="alert" className="rounded-xl border border-orange/30 bg-orange/[0.08] p-3.5 text-sm text-[#ffb183]">
          {erro}
        </p>
      )}
      {ok && <p className="text-sm text-[#D7F264]">{ok}</p>}

      {cfg.contas.length > 0 && (
        <section className="rounded-xl2 border border-border bg-surface">
          {cfg.contas.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-4 border-t border-border p-5 first:border-t-0">
              {c.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.foto_url} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface2 text-xl">📸</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  @{c.username} {c.nome && <span className="font-normal text-muted">· {c.nome}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{c.status === 'conectada' ? '🟢 Conectada' : '⚪ Desconectada'}</span>
                  {c.token_expira_em && <span>Token renova sozinho (vence {quando(c.token_expira_em)})</span>}
                  <span>Webhook: {c.webhook_assinado_em ? `assinado em ${quando(c.webhook_assinado_em)}` : <b className="text-[#ffb183]">não assinado</b>}</span>
                  <span>
                    Último evento: {c.ultima_entrada_em ? quando(c.ultima_entrada_em) : <b className="text-[#ffb183]">nenhum ainda</b>}
                  </span>
                </div>
                {c.ultimo_erro && <p className="mt-1 text-xs text-[#ffb183]">{c.ultimo_erro}</p>}
              </div>
              <div className="flex gap-2">
                {c.status === 'conectada' && (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() => void acaoConta(c.id, 'POST')}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:border-blue2 hover:text-ink"
                  >
                    {ocupado === c.id ? 'Assinando…' : 'Reassinar webhooks'}
                  </button>
                )}
                {c.status === 'conectada' ? (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() => void acaoConta(c.id, 'DELETE')}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:text-[#ffb183]"
                  >
                    Desconectar
                  </button>
                ) : (
                  <a href="/api/instagram/conectar" className="rounded-lg bg-blue px-3 py-2 text-xs font-semibold text-on-blue">
                    Reconectar
                  </a>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl2 border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold">1. Dados do app do Instagram (uma vez só)</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted">
          <li>
            Em developers.facebook.com, abra o app <b className="text-ink">Se tu For</b> → <b className="text-ink">Instagram</b> →{' '}
            <b className="text-ink">Configuração da API com login do Instagram</b>. Se o produto Instagram não aparecer, adicione em
            &quot;Adicionar produto&quot;.
          </li>
          <li>
            Copie o <b className="text-ink">ID do app do Instagram</b> e a <b className="text-ink">Chave secreta do app do Instagram</b> (são
            diferentes do ID e da chave do app da Meta) e cole abaixo.
          </li>
          <li>
            Em <b className="text-ink">Configurar login para empresas do Instagram → URIs de redirecionamento OAuth</b>, cole:
            <Copiavel copiado={copiado} onCopiar={(v) => void copiar(v)} valor={cfg.urlRetorno} />
          </li>
          <li>
            Em <b className="text-ink">Funções do app → Funções → Testadores do Instagram</b>, adicione o @ da agência e aceite o convite
            no Instagram (Configurações → Apps e sites). Enquanto o app não passar pela análise da Meta, só contas testadoras conectam.
          </li>
        </ol>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 text-sm">
            <span className="mb-1.5 block text-xs font-semibold text-muted">ID do app do Instagram</span>
            <input value={appId} onChange={(e) => setAppId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className={inputCls} />
          </label>
          <label className="min-w-[200px] flex-1 text-sm">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Chave secreta do app do Instagram</span>
            <input
              type="password"
              value={segredo}
              onChange={(e) => setSegredo(e.target.value.trim())}
              placeholder={cfg.temSegredo ? '•••••••• guardada (em branco = manter)' : ''}
              autoComplete="off"
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={ocupado !== null || !appId}
            className="rounded-xl bg-blue px-4 py-3 text-[13px] font-semibold text-on-blue hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted"
          >
            {ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </section>

      <section className="rounded-xl2 border border-border bg-surface p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold">2. Conectar a conta</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Você entra com o Instagram da agência na tela do próprio Instagram e aceita as permissões de mensagens e comentários. O
          SendFlow guarda o token no cofre (vale 60 dias e renova sozinho) e liga os avisos de comentário e DM.
        </p>
        <a
          href={pronto ? '/api/instagram/conectar' : undefined}
          aria-disabled={!pronto}
          className={`mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white ${
            pronto ? 'bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737] shadow-[0_6px_20px_rgba(225,48,108,.28)]' : 'pointer-events-none bg-surface2 text-muted'
          }`}
        >
          📸 {cfg.contas.length ? 'Conectar outra conta' : 'Conectar Instagram'}
        </a>
        {!pronto && <p className="mt-2 text-xs text-muted">Preencha o passo 1 primeiro.</p>}
      </section>

      <section className="rounded-xl2 border border-border bg-surface p-5 text-xs leading-relaxed text-muted sm:p-6">
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Webhook (automático — só se a conexão avisar que falhou)</h2>
        {!cfg.metaConfigurada && (
          <p className="mb-2 text-[#ffb183]">
            Para o SendFlow apontar o webhook sozinho, preencha os Dados do app da Meta em Conexões. Ou configure à mão:
          </p>
        )}
        No app → Instagram → Configuração da API com login do Instagram → <b className="text-ink">Configurar webhooks</b>:
        <span className="mt-2 block">URL de retorno:</span>
        <Copiavel copiado={copiado} onCopiar={(v) => void copiar(v)} valor={cfg.urlWebhook} />
        {cfg.verifyToken && (
          <>
            <span className="mt-2 block">Verificar token:</span>
            <Copiavel copiado={copiado} onCopiar={(v) => void copiar(v)} valor={cfg.verifyToken} />
          </>
        )}
        <span className="mt-2 block">Assine os campos: comments, messages, messaging_postbacks, message_reactions, messaging_seen.</span>
        <span className="mt-2 block">
          Isso mexe só no webhook de <b className="text-ink">Instagram</b> do app — o do WhatsApp (que o QS usa) não muda.
        </span>
      </section>
    </div>
  );
}
