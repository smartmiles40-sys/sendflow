'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Connection, ConnectionStatus } from '@/lib/types';
import { formatarTelefone } from '@/lib/whatsapp/jid';
import { formatWhen } from '@/lib/format';
import { inputCls } from '@/components/ui';

interface QrCode {
  base64: string | null;
  codigo: string | null;
  pairingCode: string | null;
}

const ESTILO_STATUS: Record<ConnectionStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  conectada: { label: 'Conectada', cls: 'bg-green/10 text-[#D7F264]', dot: 'bg-green' },
  conectando: { label: 'Conectando…', cls: 'bg-blue2/15 text-[#DFEFC5]', dot: 'bg-blue2', pulse: true },
  desconectada: { label: 'Desconectada', cls: 'bg-muted/15 text-muted', dot: 'bg-muted' },
  erro: { label: 'Com erro', cls: 'bg-orange/15 text-[#ffb183]', dot: 'bg-orange' },
};

export function ConexoesClient({
  initial,
  gruposPorConexao,
  configurada,
}: {
  initial: Connection[];
  gruposPorConexao: Record<string, { total: number; ativos: number }>;
  configurada: boolean;
}) {
  const [conexoes, setConexoes] = useState(initial);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  // Conexão cujo QR está aberto na tela. Um por vez: o QR expira em ~40s e manter
  // vários pedindo QR novo em paralelo só castiga a Evolution à toa.
  const [conectando, setConectando] = useState<{ id: string; qr: QrCode | null } | null>(null);

  function atualizar(c: Connection) {
    setConexoes((lista) => lista.map((x) => (x.id === c.id ? c : x)));
  }

  async function criar() {
    setCriando(true);
    setErro(null);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body.error ?? body.errors?.[0]?.message ?? 'Não foi possível criar a conexão.');
        return;
      }
      setConexoes((lista) => [...lista, body.conexao]);
      setNome('');
      // Já abre o QR: criar uma conexão e não conectar o número não serve para nada.
      setConectando({ id: body.conexao.id, qr: body.qrcode ?? null });
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setCriando(false);
    }
  }

  async function remover(c: Connection) {
    if (
      !window.confirm(
        `Remover a conexão "${c.nome}"? O número é desconectado e a instância apagada na Evolution. Os grupos e o histórico de campanhas continuam aqui.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/connections/${c.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(body.error ?? 'Não foi possível remover.');
      return;
    }
    setConexoes((lista) => lista.filter((x) => x.id !== c.id));
  }

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Conexões</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted">
          Cada conexão é um número de WhatsApp ligado por QR Code, igual ao WhatsApp Web. É por
          ele que as campanhas saem — e é dele que vêm os confirmados de entrega e leitura que
          alimentam o painel.
        </p>
      </header>

      {!configurada && (
        <div
          role="alert"
          className="mb-6 rounded-xl2 border border-orange/30 bg-orange/[0.08] p-5 text-sm leading-relaxed text-[#ffb183]"
        >
          <strong className="font-semibold">Evolution API não configurada.</strong> Defina{' '}
          <code className="font-mono text-xs">EVOLUTION_API_URL</code> e{' '}
          <code className="font-mono text-xs">EVOLUTION_API_KEY</code> nas variáveis de ambiente do
          projeto. O passo a passo está em <code className="font-mono text-xs">docs/EVOLUTION.md</code>.
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl2 border border-border bg-surface p-5">
        <label className="min-w-[240px] flex-1 text-sm">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            Nome da conexão
          </span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Comercial 1"
            className={inputCls}
            disabled={!configurada}
          />
        </label>
        <button
          onClick={() => void criar()}
          disabled={criando || !nome.trim() || !configurada}
          className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {criando ? 'Criando…' : '＋ Conectar número'}
        </button>
        {erro && (
          <p className="w-full text-sm text-[#ffb183]" role="alert">
            {erro}
          </p>
        )}
      </div>

      {conexoes.length === 0 ? (
        <div className="rounded-xl2 border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            Nenhum número conectado ainda. Dê um nome acima e clique em <b>Conectar número</b> —
            um QR Code aparece para você ler com o celular.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {conexoes.map((c) => (
            <CartaoConexao
              key={c.id}
              conexao={c}
              grupos={gruposPorConexao[c.id]}
              qrAberto={conectando?.id === c.id ? (conectando.qr ?? null) : undefined}
              onAbrirQr={(qr) => setConectando({ id: c.id, qr })}
              onFecharQr={() => setConectando(null)}
              onAtualizar={atualizar}
              onRemover={() => void remover(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CartaoConexao({
  conexao,
  grupos,
  qrAberto,
  onAbrirQr,
  onFecharQr,
  onAtualizar,
  onRemover,
}: {
  conexao: Connection;
  grupos?: { total: number; ativos: number };
  qrAberto?: QrCode | null;
  onAbrirQr: (qr: QrCode | null) => void;
  onFecharQr: () => void;
  onAtualizar: (c: Connection) => void;
  onRemover: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultadoSync, setResultadoSync] = useState<string | null>(null);
  const estilo = ESTILO_STATUS[conexao.status];
  const mostrandoQr = qrAberto !== undefined;

  const pedirQr = useCallback(async () => {
    const res = await fetch(`/api/connections/${conexao.id}/qrcode`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAviso(body.error ?? 'Não foi possível gerar o QR Code.');
      return null;
    }
    if (body.estado === 'conectada') {
      onAtualizar({ ...conexao, status: 'conectada' });
      onFecharQr();
      return null;
    }
    return (body.qrcode ?? null) as QrCode | null;
  }, [conexao, onAtualizar, onFecharQr]);

  /**
   * Enquanto o QR está na tela, renova a cada 30 s e confere se já conectou.
   *
   * O QR do WhatsApp expira por volta de 40 s. Sem a renovação, a pessoa lê um código
   * morto e vê "não foi possível conectar" sem entender por quê — o erro mais comum de
   * quem usa este tipo de ferramenta.
   *
   * O efeito depende de `mostrandoQr`, então ele mesmo se desliga quando o painel
   * fecha; guardar isso num ref seria redundante (e escrever em ref durante a
   * renderização é justamente o que faz um valor congelar sem aviso).
   */
  useEffect(() => {
    if (!mostrandoQr) return;
    const timer = setInterval(async () => {
      const qr = await pedirQr();
      if (qr) onAbrirQr(qr);
    }, 30_000);
    return () => clearInterval(timer);
  }, [mostrandoQr, pedirQr, onAbrirQr]);

  async function conferirEstado() {
    setOcupado('estado');
    setAviso(null);
    try {
      const res = await fetch(`/api/connections/${conexao.id}`);
      const body = await res.json().catch(() => ({}));
      if (body.conexao) onAtualizar(body.conexao);
      if (body.aviso) setAviso(body.aviso);
    } finally {
      setOcupado(null);
    }
  }

  async function abrirQr() {
    setOcupado('qr');
    setAviso(null);
    try {
      const qr = await pedirQr();
      onAbrirQr(qr);
    } finally {
      setOcupado(null);
    }
  }

  async function sincronizar() {
    setOcupado('sync');
    setAviso(null);
    setResultadoSync(null);
    try {
      const res = await fetch(`/api/connections/${conexao.id}/grupos`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso(body.error ?? 'Não foi possível sincronizar os grupos.');
        return;
      }
      setResultadoSync(
        `${body.total} grupo(s) no WhatsApp · ${body.novos} novo(s) · ${body.atualizados} atualizado(s)` +
          (body.sumidos ? ` · ${body.sumidos} que sumiram foram desativados` : ''),
      );
    } finally {
      setOcupado(null);
    }
  }

  async function desconectar() {
    if (!window.confirm(`Desconectar o número de "${conexao.nome}"? As campanhas dele param de sair.`)) return;
    setOcupado('desconectar');
    try {
      const res = await fetch(`/api/connections/${conexao.id}/qrcode`, { method: 'DELETE' });
      if (res.ok) onAtualizar({ ...conexao, status: 'desconectada', numero: null, profile_name: null });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="truncate text-[15px] font-semibold">{conexao.nome}</h2>
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${estilo.cls}`}
            >
              <span className={`h-[7px] w-[7px] rounded-full ${estilo.dot} ${estilo.pulse ? 'animate-chip-pulse' : ''}`} />
              {estilo.label}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {conexao.numero ? (
              <span className="tabular-nums">{formatarTelefone(conexao.numero)}</span>
            ) : (
              <span>Sem número conectado</span>
            )}
            {conexao.profile_name && <span>{conexao.profile_name}</span>}
            <span>
              {grupos ? `${grupos.ativos} de ${grupos.total} grupos ativos` : 'Nenhum grupo sincronizado'}
            </span>
            <span>
              Intervalo {conexao.delay_min_seg}–{conexao.delay_max_seg}s
              {conexao.limite_diario > 0 ? ` · até ${conexao.limite_diario}/dia` : ' · sem limite diário'}
            </span>
            {conexao.ultima_sincronizacao && (
              <span>Grupos sincronizados em {formatWhen(conexao.ultima_sincronizacao)}</span>
            )}
          </div>

          {conexao.ultimo_erro && (
            <p className="mt-2 rounded-lg border border-orange/25 bg-orange/[0.07] px-2.5 py-1.5 text-xs text-[#ffb183]">
              {conexao.ultimo_erro}
            </p>
          )}
          {aviso && (
            <p className="mt-2 text-xs text-[#ffb183]" role="alert">
              {aviso}
            </p>
          )}
          {resultadoSync && <p className="mt-2 text-xs text-[#D7F264]">{resultadoSync}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {conexao.status === 'conectada' ? (
            <>
              <Botao onClick={() => void sincronizar()} ocupado={ocupado === 'sync'}>
                Puxar grupos
              </Botao>
              <Botao onClick={() => void conferirEstado()} ocupado={ocupado === 'estado'}>
                Conferir
              </Botao>
              <Botao onClick={() => void desconectar()} ocupado={ocupado === 'desconectar'} perigo>
                Desconectar
              </Botao>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void abrirQr()}
                disabled={ocupado === 'qr'}
                className="rounded-xl bg-blue px-4 py-2.5 text-[13px] font-semibold text-on-blue transition-colors hover:bg-blue-hover disabled:opacity-50"
              >
                {ocupado === 'qr' ? 'Gerando…' : 'Ler QR Code'}
              </button>
              <Botao onClick={() => void conferirEstado()} ocupado={ocupado === 'estado'}>
                Conferir
              </Botao>
            </>
          )}
          <Botao onClick={onRemover} perigo>
            Remover
          </Botao>
        </div>
      </div>

      {mostrandoQr && (
        <PainelQr
          qr={qrAberto ?? null}
          onFechar={onFecharQr}
          onConferir={() => void conferirEstado()}
        />
      )}
    </div>
  );
}

function PainelQr({
  qr,
  onFechar,
  onConferir,
}: {
  qr: QrCode | null;
  onFechar: () => void;
  onConferir: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-6 border-t border-border bg-surface2 p-6">
      <div className="shrink-0">
        {qr?.base64 ? (
          // Fundo branco atrás do QR: a leitura do WhatsApp falha em QR sobre fundo
          // escuro, e o tema do painel é escuro.
          <div className="rounded-xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr.base64}
              alt="QR Code para conectar o WhatsApp"
              width={200}
              height={200}
              className="block h-[200px] w-[200px]"
            />
          </div>
        ) : (
          <div className="flex h-[224px] w-[224px] items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
            Gerando QR Code…
          </div>
        )}
      </div>

      <div className="min-w-[260px] flex-1 text-sm leading-relaxed text-muted">
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">
          Como conectar
        </h3>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>Abra o WhatsApp no celular que vai disparar.</li>
          <li>
            Toque em <b className="text-ink">Configurações → Aparelhos conectados</b>.
          </li>
          <li>
            Toque em <b className="text-ink">Conectar um aparelho</b> e aponte para o código.
          </li>
        </ol>
        <p className="mt-3 text-xs">
          O código se renova sozinho a cada 30 segundos — não precisa recarregar a página. Assim
          que o celular confirmar, clique em <b className="text-ink">Conferir</b>.
        </p>
        {qr?.pairingCode && (
          <p className="mt-3 text-xs">
            Prefere sem câmera? Use o código de pareamento:{' '}
            <b className="font-mono tracking-widest text-ink">{qr.pairingCode}</b>
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onConferir}
            className="rounded-xl bg-blue px-4 py-2.5 text-[13px] font-semibold text-on-blue transition-colors hover:bg-blue-hover"
          >
            Já li o código
          </button>
          <Botao onClick={onFechar}>Fechar</Botao>
        </div>
      </div>
    </div>
  );
}

function Botao({
  onClick,
  children,
  ocupado,
  perigo,
}: {
  onClick: () => void;
  children: React.ReactNode;
  ocupado?: boolean;
  perigo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      className={`rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        perigo
          ? 'border-border text-muted hover:border-[#ffb183]/40 hover:text-[#ffb183]'
          : 'border-border text-muted hover:border-blue2 hover:text-ink'
      }`}
    >
      {ocupado ? '…' : children}
    </button>
  );
}
