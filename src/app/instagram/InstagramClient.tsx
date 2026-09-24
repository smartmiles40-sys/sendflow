'use client';

// Instagram no módulo ManyChat: conectar a conta e programar as respostas automáticas.

import { useEffect, useState } from 'react';
import { ConexaoInstagram, type ConfigIg } from './ConexaoInstagram';
import { AutomacoesInstagram } from './AutomacoesInstagram';
import { ConversasInstagram } from './ConversasInstagram';
import { ComentariosInstagram } from './ComentariosInstagram';

type Aba = 'automacoes' | 'conversas' | 'comentarios' | 'conexao';

export function InstagramClient({ retorno }: { retorno: { erro: string | null; conectado: string | null; avisos: string | null } }) {
  const [cfg, setCfg] = useState<ConfigIg | null>(null);
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = useState<Aba | null>(null);
  const [contaId, setContaId] = useState<string>('');

  useEffect(() => {
    let vivo = true;
    fetch('/api/instagram/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: ConfigIg | null) => {
        if (!vivo || !c) return;
        setCfg(c);
        const ativa = c.contas.find((x) => x.status === 'conectada') ?? c.contas[0];
        setContaId((atual) => atual || ativa?.id || '');
        // Sem conta conectada, a única aba útil é a de conexão.
        setAba((atual) => atual ?? (c.contas.some((x) => x.status === 'conectada') ? 'automacoes' : 'conexao'));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [versao]);

  const temConta = Boolean(cfg?.contas.some((c) => c.status === 'conectada'));
  const abas: { key: Aba; label: string; exigeConta: boolean }[] = [
    { key: 'automacoes', label: 'Automações', exigeConta: true },
    { key: 'conversas', label: 'Conversas', exigeConta: true },
    { key: 'comentarios', label: 'Comentários', exigeConta: true },
    { key: 'conexao', label: 'Conexão', exigeConta: false },
  ];

  return (
    <div className="max-w-5xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Instagram</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            O que o ManyChat faz no Instagram, aqui dentro: quem <b className="text-ink">comenta</b> a palavra no post recebe
            a mensagem na DM, <b className="text-ink">palavra-chave</b> na DM tem resposta na hora, e{' '}
            <b className="text-ink">resposta ou menção no story</b> vira conversa.
          </p>
        </div>
        {cfg && cfg.contas.filter((c) => c.status === 'conectada').length > 1 && (
          <select
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            aria-label="Conta do Instagram"
            className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm"
          >
            {cfg.contas
              .filter((c) => c.status === 'conectada')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  @{c.username}
                </option>
              ))}
          </select>
        )}
      </header>

      {retorno.erro && (
        <p role="alert" className="mb-4 rounded-xl border border-orange/30 bg-orange/[0.08] p-3.5 text-sm text-[#ffb183]">
          {retorno.erro}
        </p>
      )}
      {retorno.conectado && (
        <p className="mb-4 rounded-xl border border-blue/30 bg-blue/[0.08] p-3.5 text-sm text-[#D7F264]">
          Pronto! @{retorno.conectado} está conectado.{' '}
          {retorno.avisos ? <span className="text-[#ffb183]">Pendências: {retorno.avisos}</span> : 'Comente num post para testar.'}
        </p>
      )}

      <div className="mb-4 flex gap-1.5 overflow-x-auto border-b border-border">
        {abas.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={t.exigeConta && !temConta}
            onClick={() => setAba(t.key)}
            aria-pressed={aba === t.key}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              aba === t.key ? 'border-blue text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!cfg || !aba ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : aba === 'conexao' ? (
        <ConexaoInstagram cfg={cfg} onMudou={() => setVersao((v) => v + 1)} />
      ) : aba === 'automacoes' ? (
        <AutomacoesInstagram contaId={contaId} />
      ) : aba === 'conversas' ? (
        <ConversasInstagram contaId={contaId} />
      ) : (
        <ComentariosInstagram contaId={contaId} />
      )}
    </div>
  );
}
