'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Cadencia, DestinoCadencia } from '@/lib/cadencia';
import { CATEGORIAS, categoriaLabel, type CategoriaKey } from '@/lib/categories';
import { formatWhen } from '@/lib/format';
import { Field, SegButton, inputCls } from '@/components/ui';
import { DestinoForm, resumoDestino, useOpcoesDestino } from '@/components/cadencia/DestinoForm';

type Item = Cadencia & { total_passos: number; enviados: number; proximo_envio: string | null };

export function CadenciasClient() {
  const router = useRouter();
  const opcoes = useOpcoesDestino();
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  // Criação
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState<CategoriaKey>('lives');
  const [destino, setDestino] = useState<DestinoCadencia>({
    alvo: 'grupos',
    audience_id: null,
    group_ids: null,
    list_ids: null,
    connection_id: null,
  });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    fetch('/api/cadencias', { cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok) throw new Error(b?.error ?? 'Falha ao carregar.');
        setItens(b);
      })
      .catch((e: Error) => {
        setErro(
          /cadencias/.test(e.message)
            ? 'A tabela de cadências ainda não existe no banco (migration 0016).'
            : e.message,
        );
        setItens([]);
      });
  }, []);

  async function criar() {
    setOcupado(true);
    setErros({});
    const r = await fetch('/api/cadencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, categoria, ...destino }),
    }).catch(() => null);
    const b = await r?.json().catch(() => ({}));
    setOcupado(false);
    if (!r?.ok) {
      if (Array.isArray(b?.errors)) {
        setErros(Object.fromEntries(b.errors.map((x: { field: string; message: string }) => [x.field, x.message])));
      } else setErros({ geral: b?.error ?? 'Não foi possível criar.' });
      return;
    }
    router.push(`/cadencias/${b.id}`);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Cadências</h1>
          <p className="mt-1.5 text-sm text-muted">
            Uma sequência de mensagens com dia e hora marcados, desenhada numa tela só: mensagem 1,
            mensagem 2, mensagem 3…
          </p>
        </div>
        {!criando && (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="w-full rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-on-blue transition-colors hover:bg-blue-hover sm:w-auto"
          >
            + Nova cadência
          </button>
        )}
      </div>

      {erro && (
        <div role="alert" className="mb-5 rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]">
          {erro}
        </div>
      )}

      {criando && (
        <div className="mb-6 rounded-xl2 border border-border bg-surface p-4 sm:p-[22px]">
          <h2 className="mb-4 font-display text-lg font-semibold">Nova cadência</h2>
          <Field label="Nome" hint="· ex.: Live do Japão 20/09" error={erros.nome}>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Live do Japão — 20/09"
              className={inputCls}
              autoFocus
            />
          </Field>
          <Field label="Categoria">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {CATEGORIAS.map((c) => (
                <SegButton key={c.key} on={categoria === c.key} onClick={() => setCategoria(c.key)}>
                  {c.label}
                </SegButton>
              ))}
            </div>
          </Field>
          <DestinoForm valor={destino} onChange={setDestino} opcoes={opcoes} erro={erros.destino} />
          {erros.geral && (
            <p className="mb-3 text-sm text-[#ffb183]" role="alert">
              {erros.geral}
            </p>
          )}
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => void criar()}
              disabled={ocupado}
              className="flex-1 rounded-xl bg-blue px-5 py-[13px] text-sm font-semibold text-on-blue hover:bg-blue-hover disabled:bg-surface2 disabled:text-muted sm:flex-none"
            >
              {ocupado ? 'Criando…' : 'Criar e desenhar as mensagens ›'}
            </button>
            <button
              type="button"
              onClick={() => setCriando(false)}
              className="rounded-xl border border-border px-5 py-[13px] text-sm font-semibold text-ink hover:bg-white/5"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {itens === null ? (
        <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">Carregando…</div>
      ) : itens.length === 0 && !criando ? (
        <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
          Nenhuma cadência ainda. Crie a primeira e monte as mensagens no desenho.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {itens.map((c) => (
            <Link
              key={c.id}
              href={`/cadencias/${c.id}`}
              className="flex flex-col rounded-xl2 border border-border bg-surface p-[18px] transition-colors hover:border-blue2"
            >
              <div className="mb-1 flex items-start gap-2">
                <h2 className="min-w-0 flex-1 break-words font-display text-lg font-semibold leading-tight">
                  {c.nome}
                </h2>
                <span className="shrink-0 rounded-full border border-blue2/30 bg-blue2/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#DFEFC5]">
                  {categoriaLabel(c.categoria)}
                </span>
              </div>
              <p className="truncate text-[13px] text-muted">{resumoDestino(c, opcoes)}</p>
              <div className="mt-3 flex items-center gap-2 text-[13px]">
                <span className="text-[#C9DCD8]">
                  {c.total_passos} {c.total_passos === 1 ? 'mensagem' : 'mensagens'} · {c.enviados} enviadas
                </span>
              </div>
              <div className="mt-1 text-[12.5px] text-muted">
                {c.proximo_envio ? (
                  <>
                    Próxima: <b className="text-ink">{formatWhen(c.proximo_envio)}</b>
                  </>
                ) : c.total_passos && c.enviados === c.total_passos ? (
                  'Concluída ✓'
                ) : (
                  'Nada agendado'
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
