'use client';

// O cartão "Conectar com a Meta" — o mesmo caminho do ManyChat e do QS.
//
// Em vez de pedir para a pessoa caçar Phone number ID, WABA ID e token no Business
// Manager (e errar um dígito), um botão abre a janela da própria Meta: login, escolhe
// a empresa, escolhe ou cria o número, pronto. O servidor faz o resto — troca o
// código pelo token, assina o app, registra, aponta o webhook e guarda o token no
// cofre.

import { useEffect, useState } from 'react';
import type { Connection } from '@/lib/types';
import { conectarPelaMeta, type ConfigCadastro } from '@/lib/whatsapp/meta-sdk';
import { inputCls, SegButton } from '@/components/ui';

export function ConectarMeta({ onConectou }: { onConectou: (c: Connection) => void }) {
  const [cfg, setCfg] = useState<ConfigCadastro | null>(null);
  const [modo, setModo] = useState<'cloud' | 'coexistencia'>('cloud');
  const [pin, setPin] = useState('');
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [configId, setConfigId] = useState('');
  const [abrirAjustes, setAbrirAjustes] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch('/api/connections/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: ConfigCadastro | null) => {
        if (!vivo || !c) return;
        setCfg(c);
        setConfigId(c.configId ?? '');
        if (!c.configId) setAbrirAjustes(true);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const falta: string[] = [];
  if (cfg && !cfg.appId) falta.push('META_APP_ID');
  if (cfg && !cfg.podeTrocarCodigo) falta.push('META_APP_SECRET');
  if (cfg && !cfg.webhookPronto) falta.push('META_WEBHOOK_VERIFY_TOKEN');
  const pronto = Boolean(cfg?.appId && cfg.configId && cfg.podeTrocarCodigo);
  const pinOk = modo === 'coexistencia' || pin === '' || /^\d{6}$/.test(pin);

  async function salvarConfig() {
    setErro(null);
    const res = await fetch('/api/connections/meta', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ configId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setErro(body.error ?? 'Não consegui salvar.');
    setCfg(body as ConfigCadastro);
    setAbrirAjustes(false);
  }

  async function conectar() {
    if (!cfg?.appId || !cfg.configId) return;
    setOcupado(true);
    setErro(null);
    setSucesso(null);
    setAvisos([]);
    try {
      const r = await conectarPelaMeta({ appId: cfg.appId, configId: cfg.configId, modo, pin, nome });
      onConectou(r.conexao);
      setAvisos(r.avisos);
      setSucesso(`Pronto! ${r.conexao.profile_name ?? r.conexao.nome} está conectado. Mande um "oi" para o número para conferir se a volta chega.`);
      setPin('');
      setNome('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="mb-6 overflow-hidden rounded-xl2 border border-blue/40 bg-gradient-to-br from-surface to-surface2">
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#25D366]/15 text-2xl"
          >
            🟢
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Conectar WhatsApp oficial com a Meta</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Igual ao ManyChat: você entra com o Facebook, escolhe a empresa e o número, e o SendFlow faz o
              resto sozinho — token, webhook e registro. É esse número que responde as{' '}
              <b className="text-ink">automações</b> e faz o <b className="text-ink">disparo em massa</b>.
            </p>
          </div>
        </div>

        {falta.length > 0 && (
          <p role="alert" className="rounded-xl border border-orange/30 bg-orange/[0.08] p-3.5 text-sm leading-relaxed text-[#ffb183]">
            Falta configurar na Vercel: {falta.map((f) => <code key={f} className="mx-0.5 font-mono text-xs">{f}</code>)}. O
            passo a passo está em <code className="font-mono text-xs">docs/AUTOMACOES.md</code>.
          </p>
        )}

        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">Que número é?</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SegButton on={modo === 'cloud'} onClick={() => setModo('cloud')}>
              Número novo, só na API
            </SegButton>
            <SegButton on={modo === 'coexistencia'} onClick={() => setModo('coexistencia')}>
              WhatsApp Business do celular
            </SegButton>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {modo === 'cloud'
              ? 'O número passa a funcionar só pelo SendFlow (não abre mais no app do celular). Melhor para marketing e robô.'
              : 'Coexistência: o número continua no app WhatsApp Business do celular E recebe as automações. As conversas antigas vêm junto.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="min-w-[220px] flex-1 text-sm">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Nome no SendFlow <span className="font-normal normal-case tracking-normal">(opcional)</span>
            </span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Marketing oficial" className={inputCls} />
          </label>
          {modo === 'cloud' && (
            <label className="w-full text-sm sm:w-[200px]">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                PIN de 6 dígitos
              </span>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                className={inputCls}
                aria-invalid={!pinOk}
              />
            </label>
          )}
        </div>
        {modo === 'cloud' && (
          <p className="-mt-2 text-xs leading-relaxed text-muted">
            O PIN vira a verificação em duas etapas do número — invente um e <b className="text-ink">guarde</b>. Se o número já
            estava registrado na API, pode deixar em branco.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void conectar()}
            disabled={!pronto || ocupado || !pinOk}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1877F2] px-5 py-3 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(24,119,242,.28)] transition-colors hover:bg-[#166fe0] disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted disabled:shadow-none"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.69 4.54-4.69 1.31 0 2.68.23 2.68.23v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.62 23.1 24 18.1 24 12.07z" />
            </svg>
            {ocupado ? 'Conectando… (termine na janela da Meta)' : 'Continuar com o Facebook'}
          </button>
          <button
            type="button"
            onClick={() => setAbrirAjustes((v) => !v)}
            className="text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink"
          >
            {abrirAjustes ? 'Fechar ajustes do botão' : 'Ajustes do botão'}
          </button>
        </div>

        {erro && (
          <p role="alert" className="text-sm text-[#ffb183]">
            {erro}
          </p>
        )}
        {sucesso && <p className="text-sm text-[#D7F264]">{sucesso}</p>}
        {avisos.length > 0 && (
          <ul className="list-disc pl-5 text-xs leading-relaxed text-[#ffb183]">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}

        {abrirAjustes && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="text-[13px] font-semibold">Ajustes do botão (uma vez só)</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted">
              <li>
                No app da Meta (developers.facebook.com), em <b className="text-ink">Login do Facebook para Empresas → Configurações</b>,
                crie uma configuração do tipo <b className="text-ink">Cadastro incorporado do WhatsApp</b> e copie o id dela.
              </li>
              <li>
                Em <b className="text-ink">Login do Facebook → Configurações</b>, ligue &quot;Login com o SDK do JavaScript&quot; e
                adicione este domínio: <code className="font-mono">{typeof window !== 'undefined' ? window.location.host : ''}</code>
              </li>
              <li>
                Webhook deste SendFlow (o botão aponta sozinho, por número): <code className="break-all font-mono">{cfg?.urlWebhook}</code>
              </li>
            </ol>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-[220px] flex-1 text-sm">
                <span className="mb-1.5 block text-xs font-semibold text-muted">Id da configuração (config_id)</span>
                <input
                  value={configId}
                  onChange={(e) => setConfigId(e.target.value.replace(/\D/g, ''))}
                  placeholder="1067176032691119"
                  inputMode="numeric"
                  className={inputCls}
                />
              </label>
              <button
                type="button"
                onClick={() => void salvarConfig()}
                className="rounded-xl border border-border px-4 py-3 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
              >
                Salvar
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Consertos no cartão de um número oficial: reapontar o webhook e registrar com PIN.
 * Mais a prova de vida — quando chegou a última mensagem de cliente.
 */
export function ConsertosOficial({ conexao, onAtualizar }: { conexao: Connection; onAtualizar: (c: Connection) => void }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pin, setPin] = useState('');
  const [pedindoPin, setPedindoPin] = useState(false);
  const [statusMeta, setStatusMeta] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/connections/${conexao.id}/meta`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (vivo && b?.meta?.status) setStatusMeta(String(b.meta.status));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [conexao.id]);

  async function acao(corpo: Record<string, unknown>, rotulo: string) {
    setOcupado(rotulo);
    setAviso(null);
    try {
      const res = await fetch(`/api/connections/${conexao.id}/meta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) return setAviso({ ok: false, texto: b.error ?? 'A Meta recusou.' });
      if (corpo.acao === 'webhook') {
        onAtualizar({ ...conexao, webhook_apontado_em: new Date().toISOString() });
        setAviso({ ok: true, texto: 'Webhook apontado para o SendFlow. Mande um "oi" para o número para testar.' });
      } else {
        setStatusMeta('CONNECTED');
        setPedindoPin(false);
        setAviso({ ok: true, texto: 'Número registrado na API oficial.' });
      }
    } finally {
      setOcupado(null);
    }
  }

  const quando = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null;

  return (
    <div className="flex flex-col gap-2 border-t border-border px-5 py-3.5 text-xs text-muted">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>{conexao.segredo_id ? '🔐 Conectado pelo botão da Meta' : '🔑 Token das variáveis de ambiente'}</span>
        {conexao.modo_meta === 'coexistencia' && <span>📱 Coexistência com o app</span>}
        {statusMeta && statusMeta !== 'CONNECTED' && (
          <span className="font-semibold text-[#ffb183]">Na Meta: {statusMeta} — registre com o PIN</span>
        )}
        <span>
          Webhook: {conexao.webhook_apontado_em ? `apontado em ${quando(conexao.webhook_apontado_em)}` : 'ainda não apontado por aqui'}
        </span>
        <span>
          Última mensagem recebida:{' '}
          {conexao.ultima_entrada_em ? quando(conexao.ultima_entrada_em) : <b className="text-[#ffb183]">nenhuma ainda</b>}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void acao({ acao: 'webhook' }, 'webhook')}
          disabled={ocupado !== null}
          className="rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:border-blue2 hover:text-ink disabled:opacity-60"
        >
          {ocupado === 'webhook' ? 'Apontando…' : 'Apontar o webhook para cá'}
        </button>
        {!pedindoPin ? (
          <button
            type="button"
            onClick={() => setPedindoPin(true)}
            className="rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:border-blue2 hover:text-ink"
          >
            Registrar com PIN
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="PIN de 6 dígitos"
              inputMode="numeric"
              className="w-[140px] rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-blue2"
            />
            <button
              type="button"
              disabled={!/^\d{6}$/.test(pin) || ocupado !== null}
              onClick={() => void acao({ acao: 'registrar', pin }, 'registrar')}
              className="rounded-lg bg-blue px-3 py-1.5 font-semibold text-on-blue disabled:bg-surface2 disabled:text-muted"
            >
              {ocupado === 'registrar' ? 'Registrando…' : 'Registrar'}
            </button>
          </span>
        )}
      </div>
      {aviso && (
        <p role="alert" className={aviso.ok ? 'text-[#D7F264]' : 'text-[#ffb183]'}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
