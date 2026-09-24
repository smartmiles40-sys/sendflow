'use client';

// O registro dos comentários: o que chegou, qual automação pegou e o que saiu. É a
// primeira tela para abrir quando alguém diz "comentei e não recebi nada".

import { useEffect, useState } from 'react';

interface Comentario {
  id: string;
  comment_id: string;
  from_username: string | null;
  texto: string | null;
  respondido_dm_em: string | null;
  respondido_publico_em: string | null;
  erro: string | null;
  criado_em: string;
  ig_automacoes: { nome: string } | null;
}

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function ComentariosInstagram({ contaId }: { contaId: string }) {
  const [lista, setLista] = useState<Comentario[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/instagram/comentarios?conta=${contaId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (vivo) setLista(b?.comentarios ?? []);
      })
      .catch(() => {
        if (vivo) setLista([]);
      });
    return () => {
      vivo = false;
    };
  }, [contaId]);

  if (!lista) return <p className="text-sm text-muted">Carregando…</p>;

  return (
    <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
      {lista.length === 0 ? (
        <p className="p-6 text-sm text-muted">
          Nenhum comentário recebido ainda. Se já comentaram e nada apareceu aqui, abra a aba Conexão e clique em &quot;Reassinar
          webhooks&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Quem</th>
                <th className="px-4 py-2.5 font-semibold">Comentário</th>
                <th className="px-4 py-2.5 font-semibold">Automação</th>
                <th className="px-4 py-2.5 font-semibold">Respondeu</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <div>{c.from_username ? `@${c.from_username}` : '—'}</div>
                    <div className="text-[11px] text-muted">{hora(c.criado_em)}</div>
                  </td>
                  <td className="max-w-[280px] px-4 py-3">
                    <p className="break-words">{c.texto}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{c.ig_automacoes?.nome ?? 'nenhuma casou'}</td>
                  <td className="px-4 py-3 text-xs">
                    {c.respondido_publico_em && <div>✓ público</div>}
                    {c.respondido_dm_em && <div>✓ DM</div>}
                    {c.erro && <div className="text-[#ffb183]">{c.erro}</div>}
                    {!c.respondido_publico_em && !c.respondido_dm_em && !c.erro && <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
