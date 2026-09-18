'use client';

import { ENQUETE_MAX_CARACTERES, ENQUETE_MAX_OPCOES } from '@/lib/enquete';
import { Field, Switch, inputCls } from './ui';

/**
 * Opções da enquete + "várias respostas". A pergunta fica no campo de mensagem de quem
 * usa este componente (é o mesmo texto que vai em cima das opções no WhatsApp).
 */
export function EnqueteEditor({
  opcoes,
  onOpcoes,
  multipla,
  onMultipla,
  erro,
}: {
  opcoes: string[];
  onOpcoes: (o: string[]) => void;
  multipla: boolean;
  onMultipla: (v: boolean) => void;
  erro?: string;
}) {
  const lista = opcoes.length ? opcoes : ['', ''];

  function mudar(i: number, valor: string) {
    const nova = [...lista];
    nova[i] = valor;
    onOpcoes(nova);
  }

  return (
    <>
      <Field label="Opções" hint={`· de 2 a ${ENQUETE_MAX_OPCOES}`} error={erro}>
        <div className="flex flex-col gap-2">
          {lista.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
              <input
                value={o}
                maxLength={ENQUETE_MAX_CARACTERES}
                onChange={(e) => mudar(i, e.target.value)}
                onKeyDown={(e) => {
                  // Enter na última opção já abre a próxima, como no próprio WhatsApp.
                  if (e.key === 'Enter' && i === lista.length - 1 && lista.length < ENQUETE_MAX_OPCOES) {
                    e.preventDefault();
                    onOpcoes([...lista, '']);
                  }
                }}
                placeholder={i === 0 ? 'Ex.: Sim, vou!' : i === 1 ? 'Ex.: Não consigo' : `Opção ${i + 1}`}
                aria-label={`Opção ${i + 1}`}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => onOpcoes(lista.filter((_, j) => j !== i))}
                disabled={lista.length <= 2}
                aria-label={`Remover opção ${i + 1}`}
                className="shrink-0 rounded-lg px-2.5 py-2 text-muted transition-colors hover:bg-white/5 hover:text-ink disabled:invisible"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {lista.length < ENQUETE_MAX_OPCOES && (
          <button
            type="button"
            onClick={() => onOpcoes([...lista, ''])}
            className="ml-7 mt-2.5 text-[13px] font-semibold text-blue2 hover:text-ink"
          >
            + Adicionar opção
          </button>
        )}
      </Field>

      <Field>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface2 px-3.5 py-3">
          <span className="text-sm">
            <span className="font-semibold">Permitir várias respostas</span>
            <span className="mt-0.5 block font-normal text-muted">
              desligado, cada pessoa marca só uma opção
            </span>
          </span>
          <Switch checked={multipla} onChange={onMultipla} label="Permitir várias respostas" />
        </label>
      </Field>
    </>
  );
}
