'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CampoPersonalizado } from '@/lib/automacao/tipos';
import { Field, inputCls, SegButton } from '@/components/ui';
import { api, ApagarInline, Aviso, btnPrimario, btnSecundario, Cartao, Copiar, Vazio } from './comum';

const TIPOS: { id: CampoPersonalizado['tipo']; rotulo: string }[] = [
  { id: 'texto', rotulo: 'Texto' },
  { id: 'numero', rotulo: 'Número' },
  { id: 'data', rotulo: 'Data' },
  { id: 'sim_nao', rotulo: 'Sim/Não' },
  { id: 'email', rotulo: 'E-mail' },
  { id: 'telefone', rotulo: 'Telefone' },
];

/** Variáveis que já existem em todo contato, sem precisar criar. */
const FIXOS = [
  { chave: 'primeiro_nome', rotulo: 'Primeiro nome' },
  { chave: 'nome', rotulo: 'Nome completo' },
  { chave: 'telefone', rotulo: 'Telefone' },
  { chave: 'email', rotulo: 'E-mail' },
];

export function AbaCampos() {
  const [campos, setCampos] = useState<CampoPersonalizado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [rotulo, setRotulo] = useState('');
  const [tipo, setTipo] = useState<CampoPersonalizado['tipo']>('texto');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const d = await api<{ campos: CampoPersonalizado[] }>('/api/campos');
      setCampos(d.campos ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCampos([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar();
  }, [carregar]);

  async function criar() {
    if (!rotulo.trim()) return setErro('Dê um nome ao campo.');
    setOcupado(true);
    setErro(null);
    try {
      await api('/api/campos', { method: 'POST', json: { rotulo, tipo } });
      setRotulo('');
      setTipo('texto');
      setCriando(false);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-start gap-3">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
            Campos personalizados guardam o que você descobre na conversa — destino de interesse, data da viagem, quantas
            pessoas. Um bloco <b className="text-ink">Pergunta</b> salva a resposta num campo; a ação{' '}
            <b className="text-ink">Definir campo</b> grava um valor; e qualquer mensagem pode usar{' '}
            <code className="font-mono text-ink">{'{{chave}}'}</code> para personalizar.
          </p>
          {!criando && (
            <button type="button" onClick={() => setCriando(true)} className={`${btnPrimario} w-full sm:w-auto`}>
              + Novo campo
            </button>
          )}
        </div>

        {erro && (
          <div className="mb-4">
            <Aviso>{erro}</Aviso>
          </div>
        )}

        {criando && (
          <Cartao className="mb-4 border-blue2/40">
            <Field label="Nome do campo" hint="· ex.: Destino de interesse">
              <input
                value={rotulo}
                onChange={(e) => setRotulo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !ocupado && void criar()}
                placeholder="Destino de interesse"
                className={inputCls}
                autoFocus
              />
            </Field>
            <Field label="Tipo">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {TIPOS.map((t) => (
                  <SegButton key={t.id} on={tipo === t.id} onClick={() => setTipo(t.id)}>
                    {t.rotulo}
                  </SegButton>
                ))}
              </div>
            </Field>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" onClick={() => void criar()} disabled={ocupado} className={`${btnPrimario} flex-1 sm:flex-none`}>
                {ocupado ? 'Criando…' : 'Criar campo'}
              </button>
              <button type="button" onClick={() => setCriando(false)} className={btnSecundario}>
                Cancelar
              </button>
            </div>
          </Cartao>
        )}

        {campos === null ? (
          <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">Carregando…</div>
        ) : campos.length === 0 && !criando ? (
          <Vazio>Nenhum campo personalizado ainda. Sugestões: destino_interesse, data_viagem, qtd_pessoas, orcamento.</Vazio>
        ) : (
          <ul className="flex flex-col gap-2">
            {campos.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl2 border border-border bg-surface px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-ink">{c.rotulo}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{TIPOS.find((t) => t.id === c.tipo)?.rotulo ?? c.tipo}</p>
                </div>
                <code className="rounded-lg border border-border bg-bg px-2 py-1 font-mono text-[12px] text-[#DFEFC5]">{`{{${c.chave}}}`}</code>
                <Copiar texto={`{{${c.chave}}}`} />
                <ApagarInline
                  onConfirmar={async () => {
                    try {
                      await api(`/api/campos/${c.id}`, { method: 'DELETE' });
                      await carregar();
                    } catch (e) {
                      setErro(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Apagar um campo só tira ele da lista: o que já foi guardado nos contatos continua lá.
        </p>
      </div>

      <Cartao className="h-fit">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">Já existem em todo contato</h3>
        <ul className="mt-3 flex flex-col gap-2">
          {FIXOS.map((f) => (
            <li key={f.chave} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[13px] text-[#C9DCD8]">{f.rotulo}</span>
              <code className="font-mono text-[12px] text-[#DFEFC5]">{`{{${f.chave}}}`}</code>
              <Copiar texto={`{{${f.chave}}}`} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Variável sem valor vira vazio na mensagem — &quot;Oi, {'{{primeiro_nome}}'}!&quot; chega como &quot;Oi, !&quot; se o
          contato não tiver nome. Prefira frases que funcionem nos dois casos.
        </p>
      </Cartao>
    </div>
  );
}
