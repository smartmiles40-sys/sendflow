'use client';

// As peças de tela que só existem na API oficial da Meta.
//
// Ficam num arquivo próprio porque não são uma variação do cartão do chip — são outra
// coisa. Um chip se conecta por QR Code, sincroniza grupos e tem intervalo entre
// mensagens. Um número oficial não tem nada disso: tem ID, tem qualidade avaliada pela
// Meta e tem TEMPLATES, que é o conteúdo que ele pode mandar.

import { useState } from 'react';
import type { Connection, WhatsAppTemplate } from '@/lib/types';
import { inputCls } from '@/components/ui';

// ── Cadastro de um número oficial ────────────────────────────────────────────────

export interface DadosOficial {
  phone_number_id: string;
  waba_id: string;
  token: string;
  msgs_por_segundo: number;
}

export function CamposOficial({
  dados,
  onChange,
  desabilitado,
}: {
  dados: DadosOficial;
  onChange: (d: DadosOficial) => void;
  desabilitado?: boolean;
}) {
  return (
    <>
      <label className="min-w-[200px] flex-1 text-sm">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          ID do número (Phone number ID)
        </span>
        <input
          value={dados.phone_number_id}
          onChange={(e) => onChange({ ...dados, phone_number_id: e.target.value.trim() })}
          placeholder="123456789012345"
          inputMode="numeric"
          className={inputCls}
          disabled={desabilitado}
        />
      </label>

      <label className="min-w-[200px] flex-1 text-sm">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          ID da conta (WABA ID)
        </span>
        <input
          value={dados.waba_id}
          onChange={(e) => onChange({ ...dados, waba_id: e.target.value.trim() })}
          placeholder="987654321098765"
          inputMode="numeric"
          className={inputCls}
          disabled={desabilitado}
        />
      </label>

      <label className="w-full text-sm">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          Token de acesso
        </span>
        <input
          type="password"
          value={dados.token}
          onChange={(e) => onChange({ ...dados, token: e.target.value.trim() })}
          placeholder="EAAG…"
          autoComplete="off"
          className={inputCls}
          disabled={desabilitado}
        />
      </label>

      <label className="w-[150px] text-sm">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          Msgs por segundo
        </span>
        <input
          type="number"
          min={1}
          max={80}
          value={dados.msgs_por_segundo}
          onChange={(e) => onChange({ ...dados, msgs_por_segundo: Number(e.target.value) })}
          className={inputCls}
          disabled={desabilitado}
        />
      </label>

      <p className="w-full text-xs leading-relaxed text-muted">
        Os dois IDs estão no <b className="text-ink">Meta Business Manager → WhatsApp → Configuração da API</b>.
        O <b className="text-ink">ID do número</b> é só dígitos e não é o telefone. Para testar, serve o token
        temporário dessa mesma tela (morre em 24 h); para valer, gere um <b className="text-ink">permanente</b> em
        Configurações do negócio → Usuários do sistema. O token vai para o cofre do banco e não aparece mais.
      </p>
    </>
  );
}

// ── Qualidade do número na Meta ──────────────────────────────────────────────────

const QUALIDADE: Record<string, { label: string; cls: string; frase: string }> = {
  GREEN: {
    label: 'Qualidade alta',
    cls: 'bg-green/10 text-[#D7F264]',
    frase: 'O número está saudável. Dá para subir o volume com segurança.',
  },
  YELLOW: {
    label: 'Qualidade média',
    cls: 'bg-blue2/15 text-[#DFEFC5]',
    frase:
      'A Meta registrou bloqueios ou denúncias. Reduza o volume, revise o texto do template e confira quem pediu para sair.',
  },
  RED: {
    label: 'Qualidade baixa',
    cls: 'bg-orange/15 text-[#ffb183]',
    frase:
      'O teto diário já caiu e a próxima etapa é a restrição do número. Pare as campanhas de marketing e revise a lista antes de mandar qualquer coisa.',
  },
  UNKNOWN: {
    label: 'Qualidade ainda não avaliada',
    cls: 'bg-muted/15 text-muted',
    frase: 'A Meta ainda não tem volume suficiente para avaliar este número.',
  },
};

export function SeloQualidade({ qualidade }: { qualidade: string | null | undefined }) {
  const q = QUALIDADE[qualidade ?? 'UNKNOWN'] ?? QUALIDADE.UNKNOWN;
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${q.cls}`}>
      {q.label}
    </span>
  );
}

export function AvisoQualidade({ qualidade }: { qualidade: string | null | undefined }) {
  if (qualidade !== 'RED' && qualidade !== 'YELLOW') return null;
  const q = QUALIDADE[qualidade];
  return (
    <p
      role="alert"
      className="mt-2 rounded-lg border border-orange/25 bg-orange/[0.07] px-2.5 py-1.5 text-xs leading-relaxed text-[#ffb183]"
    >
      {q.frase}
    </p>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────────

const ESTILO_TEMPLATE: Record<string, string> = {
  APPROVED: 'bg-green/10 text-[#D7F264]',
  PENDING: 'bg-blue2/15 text-[#DFEFC5]',
  IN_APPEAL: 'bg-blue2/15 text-[#DFEFC5]',
  REJECTED: 'bg-orange/15 text-[#ffb183]',
  PAUSED: 'bg-orange/15 text-[#ffb183]',
  DISABLED: 'bg-orange/15 text-[#ffb183]',
};

/**
 * A lista de templates deste número, com o botão de sincronizar.
 *
 * Mostrar o status importa mais do que parece: um template `APPROVED` vira `PAUSED`
 * sozinho do lado da Meta depois de muita denúncia, e a campanha inteira falha com
 * erro 132015 sem que ninguém tenha mudado nada aqui dentro.
 */
export function PainelTemplates({ conexao }: { conexao: Connection }) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function carregar(sincronizar: boolean) {
    setOcupado(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/connections/${conexao.id}/templates`, {
        method: sincronizar ? 'POST' : 'GET',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso(body.error ?? body.errors?.[0]?.message ?? 'Não foi possível ler os templates.');
        setTemplates([]);
        return;
      }
      setTemplates((body.templates ?? []) as WhatsAppTemplate[]);
      if (body.aviso) setAviso(body.aviso);
    } catch {
      setAviso('Sem conexão com o servidor.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="border-t border-border bg-surface2 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">Templates</h3>
          <p className="mt-1 text-xs text-muted">
            A primeira mensagem para quem nunca escreveu só pode ser um template aprovado. É essa
            aprovação que troca risco de bloqueio por mensagem autorizada.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void carregar(true)}
          disabled={ocupado}
          className="rounded-xl border border-border px-4 py-2.5 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:cursor-not-allowed disabled:border-border disabled:text-muted"
        >
          {ocupado ? 'Buscando…' : 'Buscar na Meta'}
        </button>
      </div>

      {aviso && (
        <p className="mb-3 text-xs text-[#ffb183]" role="alert">
          {aviso}
        </p>
      )}

      {templates === null ? (
        <button
          type="button"
          onClick={() => void carregar(false)}
          className="text-xs font-semibold text-[#D7F264] underline underline-offset-2"
        >
          Ver os templates já sincronizados
        </button>
      ) : templates.length === 0 ? (
        <p className="text-xs text-muted">
          Nenhum template sincronizado. Clique em <b className="text-ink">Buscar na Meta</b> — os templates
          são criados no Business Manager e aprovados por lá.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li
              key={`${t.nome}-${t.idioma}`}
              className="rounded-xl border border-border bg-surface p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-ink">{t.nome}</span>
                <span className="text-xs text-muted">{t.idioma}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    ESTILO_TEMPLATE[t.status] ?? 'bg-muted/15 text-muted'
                  }`}
                >
                  {t.status}
                </span>
                <span className="text-xs text-muted">{t.categoria}</span>
                {t.variaveis_corpo > 0 && (
                  <span className="text-xs text-muted">
                    {t.variaveis_corpo} variáve{t.variaveis_corpo === 1 ? 'l' : 'is'}
                  </span>
                )}
                {t.cabecalho_tipo && t.cabecalho_tipo !== 'TEXT' && (
                  <span className="text-xs text-muted">cabeçalho de {t.cabecalho_tipo.toLowerCase()}</span>
                )}
              </div>
              {t.corpo && (
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">{t.corpo}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
