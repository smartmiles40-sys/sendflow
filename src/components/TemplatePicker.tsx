'use client';

// O compositor do disparo em massa.
//
// Numa campanha de grupo a pessoa escreve o texto. No disparo em massa, não: o texto é
// um TEMPLATE já aprovado pela Meta, e o que se escolhe aqui é qual template e o que
// entra em cada lacuna dele.
//
// A tela existe para resolver dois erros que só apareceriam tarde demais:
//
//   • variável a menos — a Meta recusa com 132000, e isso acontece por destinatário,
//     com a campanha já em voo e 20 mil linhas virando falha uma a uma;
//   • template pausado — `APPROVED` vira `PAUSED` sozinho do lado da Meta depois de
//     muita denúncia, e o compositor precisa mostrar isso ANTES de agendar.
//
// A prévia usa um contato de exemplo porque a personalização só faz sentido vista
// resolvida: `{{primeiro_nome}}` no campo não diz nada; "Oi Maria" diz.

import type { WhatsAppTemplate } from '@/lib/types';
import { preverTemplate, resolverVariaveis } from '@/lib/whatsapp/massa';
import { Field, inputCls } from '@/components/ui';

/** Contato fictício da prévia. Um nome composto de propósito, para mostrar o corte. */
const EXEMPLO = {
  nome: 'Maria Silva Santos',
  email: 'maria@exemplo.com.br',
  empresa: 'Se Tu For, Eu Vou',
  campos: { cidade: 'Belo Horizonte' },
};

/** Os atalhos de personalização que o sistema entende, iguais aos do e-mail. */
const ATALHOS = ['{{primeiro_nome}}', '{{nome}}', '{{empresa}}'];

export function TemplatePicker({
  templates,
  carregando,
  templateNome,
  templateIdioma,
  variaveis,
  cabecalhoUrl,
  onEscolher,
  onVariaveis,
  onCabecalhoUrl,
  erro,
  conexaoEscolhida,
}: {
  templates: WhatsAppTemplate[];
  carregando: boolean;
  templateNome: string;
  templateIdioma: string;
  variaveis: Record<string, string>;
  cabecalhoUrl: string;
  onEscolher: (nome: string, idioma: string) => void;
  onVariaveis: (v: Record<string, string>) => void;
  onCabecalhoUrl: (url: string) => void;
  erro?: string;
  conexaoEscolhida: boolean;
}) {
  const atual = templates.find((t) => t.nome === templateNome && t.idioma === templateIdioma) ?? null;
  const aprovados = templates.filter((t) => t.status === 'APPROVED');
  const precisaMidia =
    atual?.cabecalho_tipo === 'IMAGE' ||
    atual?.cabecalho_tipo === 'VIDEO' ||
    atual?.cabecalho_tipo === 'DOCUMENT';

  if (!conexaoEscolhida) {
    return (
      <Field label="Template aprovado">
        <p className="rounded-xl border border-border bg-surface2 px-3.5 py-3 text-sm leading-relaxed text-muted">
          Escolha primeiro o número da API oficial que vai disparar. Os templates pertencem ao
          número, não ao sistema.
        </p>
      </Field>
    );
  }

  if (carregando) {
    return (
      <Field label="Template aprovado">
        <p className="rounded-xl border border-border bg-surface2 px-3.5 py-3 text-sm text-muted">
          Carregando os templates deste número…
        </p>
      </Field>
    );
  }

  if (!aprovados.length) {
    return (
      <Field label="Template aprovado" error={erro}>
        <p className="rounded-xl border border-orange/25 bg-orange/[0.07] px-3.5 py-3 text-sm leading-relaxed text-[#ffb183]">
          Nenhum template <b>aprovado</b> neste número. Os templates são criados e aprovados no Meta
          Business Manager; depois disso, abra <b>Conexões → Templates → Buscar na Meta</b> para
          trazê-los para cá.
        </p>
      </Field>
    );
  }

  return (
    <>
      <Field
        label="Template aprovado"
        hint="· é o texto que a Meta autorizou; não dá para editar aqui"
        error={erro}
      >
        <select
          value={atual ? `${atual.nome}|${atual.idioma}` : ''}
          onChange={(e) => {
            const [nome, idioma] = e.target.value.split('|');
            onEscolher(nome ?? '', idioma ?? 'pt_BR');
            // Variáveis do template anterior não valem para o novo: as posições mudam.
            onVariaveis({});
          }}
          className={inputCls}
        >
          <option value="">Escolha um template…</option>
          {aprovados.map((t) => (
            <option key={`${t.nome}|${t.idioma}`} value={`${t.nome}|${t.idioma}`}>
              {t.nome} · {t.idioma} · {t.categoria.toLowerCase()}
              {t.variaveis_corpo > 0 ? ` · ${t.variaveis_corpo} variáveis` : ''}
            </option>
          ))}
        </select>

        {templates.length > aprovados.length && (
          <p className="mt-2 text-xs text-muted">
            {templates.length - aprovados.length} template(s) deste número não estão aprovados e por
            isso não aparecem na lista.
          </p>
        )}
      </Field>

      {atual && (
        <>
          <Field label="O que a Meta aprovou">
            <div className="rounded-xl border border-border bg-surface2 p-4">
              {atual.cabecalho_texto && (
                <p className="mb-2 text-sm font-semibold text-ink">{atual.cabecalho_texto}</p>
              )}
              {precisaMidia && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  Cabeçalho de {atual.cabecalho_tipo?.toLowerCase()}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{atual.corpo}</p>
              {atual.rodape && <p className="mt-2 text-xs text-muted">{atual.rodape}</p>}
            </div>
          </Field>

          {precisaMidia && (
            <Field
              label="Arquivo do cabeçalho"
              hint="· URL pública da imagem, vídeo ou PDF"
              error={erro === 'midia' ? 'Anexe o arquivo do cabeçalho.' : undefined}
            >
              <input
                value={cabecalhoUrl}
                onChange={(e) => onCabecalhoUrl(e.target.value.trim())}
                placeholder="https://…"
                className={inputCls}
              />
              <p className="mt-2 text-xs leading-relaxed text-muted">
                A Meta baixa o arquivo pela URL na hora do envio — ele precisa estar público e
                continuar no ar enquanto a campanha dispara.
              </p>
            </Field>
          )}

          {atual.variaveis_corpo > 0 && (
            <Field label="O que entra em cada lacuna">
              <div className="flex flex-col gap-3">
                {Array.from({ length: atual.variaveis_corpo }, (_, i) => {
                  const pos = String(i + 1);
                  return (
                    <div key={pos}>
                      <label className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-blue/15 font-mono text-xs text-ink">
                          {pos}
                        </span>
                        <span className="font-normal text-muted">
                          {`aparece como {{${pos}}} no texto acima`}
                        </span>
                      </label>
                      <input
                        value={variaveis[pos] ?? ''}
                        onChange={(e) => onVariaveis({ ...variaveis, [pos]: e.target.value })}
                        placeholder="Texto fixo ou {{primeiro_nome}}"
                        className={inputCls}
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {ATALHOS.map((atalho) => (
                          <button
                            key={atalho}
                            type="button"
                            onClick={() =>
                              onVariaveis({ ...variaveis, [pos]: `${variaveis[pos] ?? ''}${atalho}` })
                            }
                            className="rounded-lg border border-border px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-blue2 hover:text-ink"
                          >
                            {atalho}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                As lacunas são preenchidas por pessoa, na hora do envio. Deixar uma em branco faz a
                Meta recusar a campanha inteira, então todas precisam de conteúdo — mesmo que seja
                texto fixo.
              </p>
            </Field>
          )}

          <Field label="Como a Maria vai receber" hint="· prévia com um contato de exemplo">
            <div className="rounded-xl border border-border bg-[#0B3238] p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {preverTemplate(
                  atual.corpo,
                  resolverVariaveis(variaveis, EXEMPLO, atual.variaveis_corpo),
                )}
              </p>
              {atual.rodape && <p className="mt-2 text-xs text-muted">{atual.rodape}</p>}
            </div>
          </Field>
        </>
      )}
    </>
  );
}
