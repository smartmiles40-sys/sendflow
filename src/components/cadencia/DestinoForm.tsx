'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Audience, Connection, Group, Lista } from '@/lib/types';
import type { DestinoCadencia } from '@/lib/cadencia';
import { AudiencePicker, type AudienceMode } from '@/components/AudiencePicker';
import { Field, SegButton, inputCls } from '@/components/ui';

export interface OpcoesDestino {
  audiences: Audience[];
  groups: Group[];
  conexoes: Connection[];
  listas: Lista[];
}

/** Carrega uma vez tudo o que o formulário de destino precisa. Falha = lista vazia. */
export function useOpcoesDestino(): OpcoesDestino {
  const [opcoes, setOpcoes] = useState<OpcoesDestino>({
    audiences: [],
    groups: [],
    conexoes: [],
    listas: [],
  });
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const ler = async (url: string) => {
        try {
          const r = await fetch(url);
          return r.ok ? await r.json() : null;
        } catch {
          return null;
        }
      };
      const [aud, grp, con, lis] = await Promise.all([
        ler('/api/audiences'),
        ler('/api/groups'),
        ler('/api/connections'),
        ler('/api/lists'),
      ]);
      if (!vivo) return;
      setOpcoes({
        audiences: Array.isArray(aud) ? aud : [],
        groups: Array.isArray(grp) ? grp : [],
        conexoes: Array.isArray(con?.conexoes) ? con.conexoes : [],
        listas: Array.isArray(lis) ? lis : [],
      });
    })();
    return () => {
      vivo = false;
    };
  }, []);
  return opcoes;
}

/** Frase curta que diz para onde a cadência vai — usada no topo do desenho. */
export function resumoDestino(d: DestinoCadencia, o: OpcoesDestino): string {
  if (d.alvo === 'contatos') {
    const nomes = (d.list_ids ?? [])
      .map((id) => o.listas.find((l) => l.id === id)?.nome)
      .filter(Boolean);
    const n = d.list_ids?.length ?? 0;
    return nomes.length ? `Contatos · ${nomes.join(', ')}` : `Contatos · ${n} lista${n === 1 ? '' : 's'}`;
  }
  if (d.audience_id) {
    const a = o.audiences.find((x) => x.id === d.audience_id);
    return a ? `Público salvo · ${a.nome}` : 'Público salvo';
  }
  const ids = d.group_ids ?? [];
  if (ids.length === 1) {
    return o.groups.find((g) => g.group_id === ids[0])?.nome ?? '1 grupo';
  }
  return `${ids.length} grupos`;
}

/**
 * Formulário "para quem vai" da cadência. Controlado: recebe o destino e devolve o
 * destino novo a cada mudança — quem chama decide quando salvar.
 */
export function DestinoForm({
  valor,
  onChange,
  opcoes,
  erro,
}: {
  valor: DestinoCadencia;
  onChange: (d: DestinoCadencia) => void;
  opcoes: OpcoesDestino;
  erro?: string;
}) {
  const [modo, setModo] = useState<AudienceMode>(valor.audience_id ? 'salvo' : 'grupos');
  const [busca, setBusca] = useState('');

  const grupos = valor.group_ids ?? [];
  const listas = valor.list_ids ?? [];

  return (
    <div>
      <Field label="Para quem vai">
        <div className="flex gap-2.5">
          <SegButton
            on={valor.alvo === 'grupos'}
            onClick={() => onChange({ ...valor, alvo: 'grupos', list_ids: null })}
          >
            Grupos
          </SegButton>
          <SegButton
            on={valor.alvo === 'contatos'}
            onClick={() =>
              onChange({ ...valor, alvo: 'contatos', audience_id: null, group_ids: null })
            }
          >
            Contatos (1 a 1)
          </SegButton>
        </div>
      </Field>

      {valor.alvo === 'grupos' ? (
        <AudiencePicker
          semTodos
          audiences={opcoes.audiences}
          groups={opcoes.groups}
          mode={modo}
          onModeChange={(m) => {
            setModo(m);
            onChange(
              m === 'salvo'
                ? { ...valor, group_ids: null }
                : { ...valor, audience_id: null },
            );
          }}
          selectedAudienceId={valor.audience_id}
          onSelectAudience={(id) => onChange({ ...valor, audience_id: id, group_ids: null })}
          selectedGroupIds={grupos}
          onToggleGroup={(gid) =>
            onChange({
              ...valor,
              audience_id: null,
              group_ids: grupos.includes(gid) ? grupos.filter((x) => x !== gid) : [...grupos, gid],
            })
          }
          groupQuery={busca}
          onGroupQueryChange={setBusca}
          error={erro}
        />
      ) : (
        <Field label="Listas de contatos" error={erro}>
          {opcoes.listas.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface2 px-3.5 py-3 text-sm text-muted">
              Nenhuma lista cadastrada.{' '}
              <Link href="/contatos" className="font-semibold text-blue2 hover:underline">
                Crie uma em Contatos e listas
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {opcoes.listas.map((l) => (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface2 px-3.5 py-3 text-sm transition-colors hover:border-blue2"
                >
                  <input
                    type="checkbox"
                    checked={listas.includes(l.id)}
                    onChange={(e) =>
                      onChange({
                        ...valor,
                        list_ids: e.target.checked
                          ? [...listas, l.id]
                          : listas.filter((x) => x !== l.id),
                      })
                    }
                    className="h-4 w-4 accent-[#D7F264]"
                  />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: l.cor }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{l.nome}</span>
                  <span className="shrink-0 text-xs text-muted">{l.total ?? 0} contatos</span>
                </label>
              ))}
            </div>
          )}
        </Field>
      )}

      {opcoes.conexoes.length > 1 && (
        <Field label="Enviar pelo número" hint="· no automático, cada grupo sai pelo número que está nele">
          <select
            value={valor.connection_id ?? ''}
            onChange={(e) => onChange({ ...valor, connection_id: e.target.value || null })}
            className={`${inputCls} [color-scheme:dark]`}
          >
            <option value="">Automático</option>
            {opcoes.conexoes.map((c) => (
              <option key={c.id} value={c.id} disabled={c.status !== 'conectada'}>
                {c.nome}
                {c.numero ? ` · ${c.numero}` : ''}
                {c.status !== 'conectada' ? ' (desconectado)' : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}
