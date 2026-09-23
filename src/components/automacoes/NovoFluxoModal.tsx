'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MODELOS } from '@/lib/automacao/modelos';
import { ROTULO_GATILHO } from '@/lib/automacao/tipos';
import { Field, inputCls } from '@/components/ui';
import { api, Aviso, btnPrimario, btnSecundario } from './comum';

/**
 * "Novo fluxo": em branco ou a partir de um modelo. O gatilho do modelo vem junto, mas
 * DESLIGADO — o texto de exemplo precisa ser revisado antes de responder cliente real.
 */
export function NovoFluxoModal({ onFechar }: { onFechar: () => void }) {
  const router = useRouter();
  const [modelo, setModelo] = useState<string>('');
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const fechar = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [onFechar]);

  async function criar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<{ fluxo: { id: string } }>('/api/fluxos', {
        method: 'POST',
        json: { nome: nome.trim() || undefined, modelo: modelo || undefined },
      });
      router.push(`/automacoes/${r.fluxo.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  const escolhido = MODELOS.find((m) => m.id === modelo);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-bg/80 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="novo-fluxo-titulo">
      <button type="button" aria-label="Fechar" onClick={onFechar} className="absolute inset-0 cursor-default" />
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl2 border border-border bg-surface sm:rounded-xl2">
        <div className="flex items-start gap-3 border-b border-border p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <h2 id="novo-fluxo-titulo" className="font-display text-xl font-semibold">
              Novo fluxo
            </h2>
            <p className="mt-1 text-[13px] text-muted">Comece em branco ou por um modelo — dá para mudar tudo depois.</p>
          </div>
          <button type="button" onClick={onFechar} className="rounded-lg px-2 py-1 text-lg text-muted hover:text-ink" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <OpcaoModelo on={modelo === ''} onClick={() => setModelo('')} icone="✏️" nome="Em branco" descricao="Só o Início e uma mensagem. Você desenha o resto." />
            {MODELOS.map((m) => (
              <OpcaoModelo
                key={m.id}
                on={modelo === m.id}
                onClick={() => setModelo(m.id)}
                icone={m.icone}
                nome={m.nome}
                descricao={m.descricao}
                gatilho={m.gatilho ? ROTULO_GATILHO[m.gatilho.tipo] : undefined}
              />
            ))}
          </div>

          <div className="mt-5">
            <Field label="Nome do fluxo" hint="· opcional">
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={escolhido?.nome ?? 'Ex.: Boas-vindas Japão'}
                className={inputCls}
                onKeyDown={(e) => e.key === 'Enter' && !ocupado && void criar()}
              />
            </Field>
          </div>
          {escolhido?.gatilho && (
            <p className="text-[12.5px] leading-relaxed text-muted">
              Este modelo já traz o gatilho <b className="text-ink">{ROTULO_GATILHO[escolhido.gatilho.tipo]}</b>, desligado. Revise
              os textos no editor, ative o fluxo e ligue o gatilho.
            </p>
          )}
          {erro && (
            <div className="mt-3">
              <Aviso>{erro}</Aviso>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5 border-t border-border p-4 sm:p-5">
          <button type="button" onClick={() => void criar()} disabled={ocupado} className={`${btnPrimario} flex-1 sm:flex-none`}>
            {ocupado ? 'Criando…' : 'Criar e abrir o editor ›'}
          </button>
          <button type="button" onClick={onFechar} className={btnSecundario}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function OpcaoModelo({
  on,
  onClick,
  icone,
  nome,
  descricao,
  gatilho,
}: {
  on: boolean;
  onClick: () => void;
  icone: string;
  nome: string;
  descricao: string;
  gatilho?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex gap-3 rounded-xl border p-3.5 text-left transition-colors ${
        on ? 'border-blue bg-blue/10' : 'border-border bg-surface2 hover:border-blue2/60'
      }`}
    >
      <span className="text-2xl leading-none" aria-hidden="true">
        {icone}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{nome}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{descricao}</span>
        {gatilho && <span className="mt-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[#DFEFC5]">Gatilho: {gatilho}</span>}
      </span>
    </button>
  );
}
