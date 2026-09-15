'use client';

import { useRef, useState } from 'react';
import type { Lista } from '@/lib/types';
import { inputCls } from '@/components/ui';
import { formatarNumero } from '@/lib/kpis';

interface Previa {
  total: number;
  validos: number;
  ignoradas: { linha: number; motivo: string }[];
  totalIgnoradas: number;
  colunas: {
    nome: number | null;
    email: number | null;
    telefone: number | null;
    empresa: number | null;
    tags: number | null;
    extras: { chave: string; indice: number }[];
  };
  amostra: { nome: string | null; email: string | null; telefone: string | null }[];
}

/**
 * Importação de CSV em duas etapas: PRÉVIA e depois gravação.
 *
 * A prévia não é enfeite. Importar contato é a operação mais fácil de errar em silêncio
 * deste sistema — coluna trocada, arquivo com ponto e vírgula, telefone sem DDD — e o
 * erro só aparece na hora do disparo, quando já não dá para desfazer. Mostrar "reconheci
 * estas colunas, 412 contatos válidos, 3 linhas com problema" antes de gravar transforma
 * um acidente silencioso numa conferência de dois segundos.
 */
export function ImportarContatos({
  listas,
  onFechar,
  onConcluido,
}: {
  listas: Lista[];
  onFechar: () => void;
  onConcluido: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [listIds, setListIds] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  async function lerArquivo(arquivo: File) {
    // Lido no NAVEGADOR: a análise da prévia é local e o arquivo só viaja para o
    // servidor quando a pessoa confirma.
    const texto = await arquivo.text();
    setCsv(texto);
    void analisar(texto);
  }

  async function analisar(texto: string) {
    setOcupado(true);
    setErro(null);
    try {
      const res = await fetch('/api/contacts/importar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: texto }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body.error ?? 'Não foi possível ler o arquivo.');
        return;
      }
      setPrevia(body as Previa);
    } catch {
      setErro('Sem conexão com o servidor.');
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setOcupado(true);
    setErro(null);
    try {
      const res = await fetch('/api/contacts/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, list_ids: listIds, tags }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body.error ?? 'Não foi possível importar.');
        return;
      }
      setResultado(
        `${formatarNumero(body.criados)} contato(s) novo(s) e ${formatarNumero(body.atualizados)} atualizado(s).` +
          (body.totalIgnoradas ? ` ${formatarNumero(body.totalIgnoradas)} linha(s) ignorada(s).` : ''),
      );
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-5 py-10">
      <div className="w-full max-w-2xl rounded-xl2 border border-border bg-surface p-6 shadow-[0_24px_60px_rgba(0,0,0,.6)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Importar contatos</h2>
            <p className="mt-1 text-sm text-muted">
              Aceita CSV do Excel, do Google Planilhas ou exportado de outro sistema.
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:text-ink"
          >
            ✕
          </button>
        </div>

        {resultado ? (
          <div>
            <div className="rounded-xl border border-green/30 bg-green/[0.07] px-4 py-3.5 text-sm text-[#7effcf]">
              ✓ {resultado}
            </div>
            <button
              type="button"
              onClick={onConcluido}
              className="mt-5 w-full rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0a54ff]"
            >
              Ver contatos
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <span className="mb-[9px] block text-[13px] font-semibold">1. Escolha o arquivo</span>
              <input
                ref={inputArquivo}
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void lerArquivo(f);
                }}
                className="block w-full cursor-pointer rounded-xl border border-border bg-surface2 px-3.5 py-3 text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-blue file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
              <p className="mt-2 text-xs leading-relaxed text-muted">
                O arquivo precisa ter uma linha de cabeçalho e ao menos uma coluna de{' '}
                <b className="text-ink">e-mail</b> ou <b className="text-ink">telefone</b>. Nomes de
                coluna reconhecidos automaticamente: nome, e-mail, telefone/celular/whatsapp,
                empresa e tags. Qualquer outra coluna vira variável para personalizar a mensagem.
              </p>
            </div>

            {ocupado && !previa && <p className="text-sm text-muted">Lendo o arquivo…</p>}

            {previa && (
              <>
                <div className="mb-5 rounded-xl border border-border bg-surface2 p-4">
                  <span className="mb-2.5 block text-[13px] font-semibold">2. Confira o que entendi</span>
                  <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    <span>
                      <b className="text-[#7effcf]">{formatarNumero(previa.validos)}</b> contatos válidos
                    </span>
                    {previa.totalIgnoradas > 0 && (
                      <span>
                        <b className="text-[#ffb183]">{formatarNumero(previa.totalIgnoradas)}</b> linhas
                        ignoradas
                      </span>
                    )}
                    <span className="text-muted">de {formatarNumero(previa.total)} no arquivo</span>
                  </div>

                  <ul className="flex flex-col gap-1 text-xs text-muted">
                    <Coluna rotulo="Nome" indice={previa.colunas.nome} />
                    <Coluna rotulo="E-mail" indice={previa.colunas.email} />
                    <Coluna rotulo="Telefone" indice={previa.colunas.telefone} />
                    <Coluna rotulo="Empresa" indice={previa.colunas.empresa} />
                    <Coluna rotulo="Tags" indice={previa.colunas.tags} />
                    {previa.colunas.extras.length > 0 && (
                      <li>
                        ✓ Variáveis extras:{' '}
                        {previa.colunas.extras.map((e) => `{{${e.chave}}}`).join(', ')}
                      </li>
                    )}
                  </ul>

                  {previa.amostra.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                      <span className="mb-1.5 block text-xs font-semibold text-muted">
                        Primeiras linhas:
                      </span>
                      {previa.amostra.map((a, i) => (
                        <div key={i} className="truncate text-xs text-muted">
                          {[a.nome, a.email, a.telefone].filter(Boolean).join(' · ')}
                        </div>
                      ))}
                    </div>
                  )}

                  {previa.ignoradas.length > 0 && (
                    <details className="mt-3 border-t border-border pt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-[#ffb183]">
                        Ver as {previa.totalIgnoradas} linha(s) com problema
                      </summary>
                      <ul className="mt-2 flex max-h-32 flex-col gap-0.5 overflow-auto text-xs text-muted">
                        {previa.ignoradas.map((ig, i) => (
                          <li key={i}>
                            Linha {ig.linha}: {ig.motivo}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                <div className="mb-5">
                  <span className="mb-[9px] block text-[13px] font-semibold">
                    3. Onde colocar (opcional)
                  </span>
                  {listas.length > 0 && (
                    <div className="mb-3 flex flex-col gap-2">
                      {listas.map((l) => (
                        <label
                          key={l.id}
                          className="flex cursor-pointer items-center gap-2.5 text-sm text-muted"
                        >
                          <input
                            type="checkbox"
                            checked={listIds.includes(l.id)}
                            onChange={(e) =>
                              setListIds((atual) =>
                                e.target.checked ? [...atual, l.id] : atual.filter((x) => x !== l.id),
                              )
                            }
                            className="h-4 w-4 accent-[#0147FF]"
                          />
                          {l.nome}
                        </label>
                      ))}
                    </div>
                  )}
                  <input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="Tags para todos deste arquivo — ex.: feira-2026, indicacao"
                    className={inputCls}
                  />
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    Tags são <b className="text-ink">somadas</b> às que o contato já tem — importar de
                    novo nunca apaga marcação antiga. Contato que já existe é atualizado só nos campos
                    preenchidos no arquivo, e quem descadastrou <b className="text-ink">continua fora</b>.
                  </p>
                </div>

                {erro && (
                  <p className="mb-4 text-sm text-[#ffb183]" role="alert">
                    {erro}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onFechar}
                    className="rounded-xl border border-border px-5 py-3 text-sm font-semibold text-muted transition-colors hover:text-ink"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void importar()}
                    disabled={ocupado || previa.validos === 0}
                    className="flex-1 rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0a54ff] disabled:opacity-50"
                  >
                    {ocupado
                      ? 'Importando…'
                      : `Importar ${formatarNumero(previa.validos)} contato(s)`}
                  </button>
                </div>
              </>
            )}

            {erro && !previa && (
              <p className="mt-4 text-sm text-[#ffb183]" role="alert">
                {erro}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Coluna({ rotulo, indice }: { rotulo: string; indice: number | null }) {
  return (
    <li className={indice === null ? 'text-muted/60' : ''}>
      {indice === null ? '—' : '✓'} {rotulo}
      {indice === null && ' (não encontrada no arquivo)'}
    </li>
  );
}
