'use client';

import { useState } from 'react';
import { inputCls, SegButton, Switch } from '@/components/ui';
import { uploadMedia } from '@/lib/upload-client';
import { LIMITES, novoId, type Bloco, type DadosMensagem, type Interacao } from '@/lib/automacao/tipos';
import { Contador, labelCls, miniBtn, Numero, perigoBtn, Secao, TextoVar } from './campos';
import type { Recursos } from './recursos';

type TipoMidia = 'imagem' | 'video' | 'audio' | 'documento';

const ROTULO_BLOCO: Record<Bloco['tipo'], string> = {
  texto: '💬 Texto',
  imagem: '🖼️ Imagem',
  video: '🎬 Vídeo',
  audio: '🎧 Áudio',
  documento: '📄 Documento',
};

const ACCEPT: Record<TipoMidia, string> = {
  imagem: 'image/jpeg,image/png,image/webp',
  video: 'video/mp4',
  audio: 'audio/mpeg,audio/ogg,audio/mp4,audio/aac',
  documento: 'application/pdf',
};

function EnvioMidia({ tipo, onUrl }: { tipo: TipoMidia; onUrl: (u: string) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <div className="mt-1.5">
      <label className={`${miniBtn} inline-flex cursor-pointer items-center gap-1.5`}>
        {enviando ? 'Enviando…' : '⬆ Enviar arquivo do computador'}
        <input
          type="file"
          accept={ACCEPT[tipo]}
          className="sr-only"
          disabled={enviando}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setEnviando(true);
            setErro(null);
            const r = await uploadMedia(f);
            setEnviando(false);
            if ('error' in r) setErro(r.error);
            else onUrl(r.url);
          }}
        />
      </label>
      {erro && (
        <p className="mt-1 text-[11px] text-[#ffb183]" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

export function EditorMensagem({
  dados,
  mudar,
  rec,
}: {
  dados: DadosMensagem;
  mudar: (d: DadosMensagem) => void;
  rec: Recursos;
}) {
  const d = dados;
  const interativa = d.interacao.tipo !== 'nenhuma';
  const set = (patch: Partial<DadosMensagem>) => mudar({ ...d, ...patch });
  const setBloco = (i: number, b: Bloco) => set({ blocos: d.blocos.map((x, j) => (j === i ? b : x)) });
  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= d.blocos.length) return;
    const nova = [...d.blocos];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    set({ blocos: nova });
  };
  const setInteracao = (it: Interacao) => set({ interacao: it });

  function trocarTipoInteracao(t: Interacao['tipo']) {
    if (t === d.interacao.tipo) return;
    if (t === 'nenhuma') setInteracao({ tipo: 'nenhuma' });
    if (t === 'botoes') setInteracao({ tipo: 'botoes', botoes: [{ id: novoId('b'), titulo: '' }] });
    if (t === 'lista')
      setInteracao({ tipo: 'lista', rotuloBotao: 'Ver opções', secoes: [{ titulo: '', itens: [{ id: novoId('i'), titulo: '' }] }] });
    if (t === 'link') setInteracao({ tipo: 'link', rotulo: 'Abrir', url: 'https://' });
  }

  const ultimoEhTexto = d.blocos[d.blocos.length - 1]?.tipo === 'texto';
  const totalItens = d.interacao.tipo === 'lista' ? d.interacao.secoes.reduce((s, x) => s + x.itens.length, 0) : 0;

  return (
    <>
      <Secao titulo="Conteúdo" dica="Cada bloco sai como uma mensagem separada, nesta ordem. Negrito no WhatsApp: *assim*.">
        <div className="flex flex-col gap-3">
          {d.blocos.map((b, i) => {
            const eUltimoTexto = interativa && i === d.blocos.length - 1 && b.tipo === 'texto';
            return (
              <div key={i} className="rounded-xl border border-border bg-surface2/60 p-3">
                <div className="mb-2 flex items-center gap-1">
                  <span className="flex-1 text-[12px] font-semibold text-ink">{ROTULO_BLOCO[b.tipo]}</span>
                  <button type="button" className={perigoBtn} onClick={() => mover(i, -1)} disabled={i === 0} title="Subir">
                    ↑
                  </button>
                  <button type="button" className={perigoBtn} onClick={() => mover(i, 1)} disabled={i === d.blocos.length - 1} title="Descer">
                    ↓
                  </button>
                  <button type="button" className={perigoBtn} onClick={() => set({ blocos: d.blocos.filter((_, j) => j !== i) })} title="Remover">
                    ✕
                  </button>
                </div>
                {b.tipo === 'texto' ? (
                  <TextoVar
                    valor={b.texto}
                    onChange={(texto) => setBloco(i, { tipo: 'texto', texto })}
                    max={eUltimoTexto ? LIMITES.textoInterativo : LIMITES.texto}
                    placeholder="Oi {{primeiro_nome}}! 👋"
                    linhas={4}
                    variaveis={rec.campos}
                    dica={eUltimoTexto ? 'Este texto vai junto com os botões — limite de 1024 caracteres.' : undefined}
                  />
                ) : (
                  <>
                    <label className={labelCls}>Link do arquivo (https)</label>
                    <input
                      value={b.url}
                      onChange={(e) => setBloco(i, { ...b, url: e.target.value.trim() })}
                      placeholder="https://…"
                      className={`${inputCls} py-2.5`}
                    />
                    <EnvioMidia tipo={b.tipo} onUrl={(url) => setBloco(i, { ...b, url })} />
                    {b.tipo !== 'audio' && (
                      <div className="mt-3">
                        <TextoVar
                          rotulo="Legenda (opcional)"
                          valor={b.legenda ?? ''}
                          onChange={(legenda) => setBloco(i, { ...b, legenda })}
                          max={LIMITES.legenda}
                          linhas={2}
                          variaveis={rec.campos}
                        />
                      </div>
                    )}
                    {b.tipo === 'documento' && (
                      <>
                        <label className={labelCls}>Nome do arquivo que a pessoa vê</label>
                        <input
                          value={b.nome ?? ''}
                          onChange={(e) => setBloco(i, { ...b, nome: e.target.value })}
                          placeholder="roteiro-japao.pdf"
                          className={`${inputCls} py-2.5`}
                        />
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" className={miniBtn} onClick={() => set({ blocos: [...d.blocos, { tipo: 'texto', texto: '' }] })}>
            + Texto
          </button>
          {(['imagem', 'video', 'audio', 'documento'] as TipoMidia[]).map((t) => (
            <button key={t} type="button" className={miniBtn} onClick={() => set({ blocos: [...d.blocos, { tipo: t, url: '' }] })}>
              + {ROTULO_BLOCO[t].split(' ')[1]}
            </button>
          ))}
        </div>
      </Secao>

      <Secao titulo="Botões e interação" dica="Botões e lista fazem o fluxo esperar a resposta e seguir por um caminho para cada opção.">
        <div className="mb-3 flex flex-wrap gap-1.5">
          <SegButton on={d.interacao.tipo === 'nenhuma'} onClick={() => trocarTipoInteracao('nenhuma')}>
            Nenhuma
          </SegButton>
          <SegButton on={d.interacao.tipo === 'botoes'} onClick={() => trocarTipoInteracao('botoes')}>
            Botões
          </SegButton>
          <SegButton on={d.interacao.tipo === 'lista'} onClick={() => trocarTipoInteracao('lista')}>
            Lista
          </SegButton>
          <SegButton on={d.interacao.tipo === 'link'} onClick={() => trocarTipoInteracao('link')}>
            Link
          </SegButton>
        </div>

        {interativa && !ultimoEhTexto && (
          <p className="mb-3 rounded-lg border border-orange/25 bg-orange/[0.07] px-2.5 py-1.5 text-[11px] text-[#ffb183]" role="alert">
            Botões, lista e link vão presos a um texto: o último bloco precisa ser um Texto.
          </p>
        )}

        {d.interacao.tipo === 'botoes' && (() => {
          const it = d.interacao;
          return (
            <div className="flex flex-col gap-2">
              {it.botoes.map((b, i) => (
                <div key={b.id} className="flex items-center gap-1.5">
                  <input
                    value={b.titulo}
                    onChange={(e) =>
                      setInteracao({ ...it, botoes: it.botoes.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)) })
                    }
                    placeholder={`Botão ${i + 1}`}
                    className={`${inputCls} py-2`}
                    aria-invalid={b.titulo.length > LIMITES.tituloBotao}
                  />
                  <Contador valor={b.titulo} max={LIMITES.tituloBotao} />
                  <button
                    type="button"
                    className={perigoBtn}
                    onClick={() => setInteracao({ ...it, botoes: it.botoes.filter((_, j) => j !== i) })}
                    title="Remover botão"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={`${miniBtn} self-start`}
                disabled={it.botoes.length >= LIMITES.botoes}
                onClick={() => setInteracao({ ...it, botoes: [...it.botoes, { id: novoId('b'), titulo: '' }] })}
              >
                + Botão ({it.botoes.length}/{LIMITES.botoes})
              </button>
            </div>
          );
        })()}

        {d.interacao.tipo === 'lista' && (() => {
          const it = d.interacao;
          const setSecao = (si: number, s: (typeof it.secoes)[number]) =>
            setInteracao({ ...it, secoes: it.secoes.map((x, j) => (j === si ? s : x)) });
          return (
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span className={labelCls.replace('mb-1.5 ', '')}>Texto do botão que abre a lista</span>
                  <Contador valor={it.rotuloBotao} max={LIMITES.rotuloBotaoLista} />
                </div>
                <input
                  value={it.rotuloBotao}
                  onChange={(e) => setInteracao({ ...it, rotuloBotao: e.target.value })}
                  className={`${inputCls} py-2`}
                />
              </div>
              {it.secoes.map((s, si) => (
                <div key={si} className="rounded-xl border border-border p-2.5">
                  <div className="mb-2 flex items-center gap-1.5">
                    <input
                      value={s.titulo}
                      onChange={(e) => setSecao(si, { ...s, titulo: e.target.value })}
                      placeholder={it.secoes.length > 1 ? 'Título da seção (obrigatório)' : 'Título da seção (opcional)'}
                      className={`${inputCls} py-2 text-[13px]`}
                    />
                    <Contador valor={s.titulo} max={24} />
                    {it.secoes.length > 1 && (
                      <button
                        type="button"
                        className={perigoBtn}
                        onClick={() => setInteracao({ ...it, secoes: it.secoes.filter((_, j) => j !== si) })}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {s.itens.map((item, ii) => (
                    <div key={item.id} className="mb-2 rounded-lg bg-surface2/60 p-2">
                      <div className="flex items-center gap-1.5">
                        <input
                          value={item.titulo}
                          onChange={(e) =>
                            setSecao(si, { ...s, itens: s.itens.map((x, j) => (j === ii ? { ...x, titulo: e.target.value } : x)) })
                          }
                          placeholder={`Opção ${ii + 1}`}
                          className={`${inputCls} py-2`}
                        />
                        <Contador valor={item.titulo} max={LIMITES.tituloItem} />
                        <button
                          type="button"
                          className={perigoBtn}
                          onClick={() => setSecao(si, { ...s, itens: s.itens.filter((_, j) => j !== ii) })}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input
                          value={item.descricao ?? ''}
                          onChange={(e) =>
                            setSecao(si, { ...s, itens: s.itens.map((x, j) => (j === ii ? { ...x, descricao: e.target.value } : x)) })
                          }
                          placeholder="Descrição (opcional)"
                          className={`${inputCls} py-1.5 text-[12px]`}
                        />
                        <Contador valor={item.descricao ?? ''} max={LIMITES.descricaoItem} />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={miniBtn}
                    disabled={totalItens >= LIMITES.itensLista}
                    onClick={() => setSecao(si, { ...s, itens: [...s.itens, { id: novoId('i'), titulo: '' }] })}
                  >
                    + Opção
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className={miniBtn}
                  onClick={() => setInteracao({ ...it, secoes: [...it.secoes, { titulo: '', itens: [] }] })}
                >
                  + Seção
                </button>
                <span className={`text-[11px] ${totalItens > LIMITES.itensLista ? 'text-[#ffb183]' : 'text-muted'}`}>
                  {totalItens}/{LIMITES.itensLista} opções
                </span>
              </div>
            </div>
          );
        })()}

        {d.interacao.tipo === 'link' && (() => {
          const it = d.interacao;
          return (
            <div className="flex flex-col gap-2">
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span className={labelCls.replace('mb-1.5 ', '')}>Texto do botão</span>
                  <Contador valor={it.rotulo} max={LIMITES.tituloBotao} />
                </div>
                <input value={it.rotulo} onChange={(e) => setInteracao({ ...it, rotulo: e.target.value })} className={`${inputCls} py-2`} />
              </div>
              <div>
                <label className={labelCls}>Endereço</label>
                <input
                  value={it.url}
                  onChange={(e) => setInteracao({ ...it, url: e.target.value.trim() })}
                  placeholder="https://setuforeuvouviagens.com.br/…"
                  className={`${inputCls} py-2`}
                />
              </div>
            </div>
          );
        })()}

        {interativa && (
          <div className="mt-4 grid grid-cols-1 gap-2">
            <TextoVar rotulo="Cabeçalho (opcional)" valor={d.cabecalho ?? ''} onChange={(cabecalho) => set({ cabecalho })} max={LIMITES.cabecalho} linhas={1} semVariaveis />
            <TextoVar rotulo="Rodapé cinza (opcional)" valor={d.rodape ?? ''} onChange={(rodape) => set({ rodape })} max={LIMITES.rodape} linhas={1} semVariaveis />
          </div>
        )}

        {(d.interacao.tipo === 'botoes' || d.interacao.tipo === 'lista') && (
          <div className="mt-2">
            <label className={labelCls}>Esperar o clique por (minutos)</label>
            <Numero valor={d.esperarMinutos ?? 0} min={0} onChange={(esperarMinutos) => set({ esperarMinutos: Math.max(0, esperarMinutos) })} />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              0 = espera para sempre. Com um prazo, aparece a saída <b className="text-ink">Não respondeu</b> para você mandar um lembrete.
            </p>
          </div>
        )}
      </Secao>

      <Secao titulo="Comportamento">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] text-ink">Mostrar “digitando…”</div>
            <p className="text-[11px] text-muted">Pausa curta entre as mensagens, como uma pessoa. Parece menos robô.</p>
          </div>
          <Switch checked={Boolean(d.digitando)} onChange={(digitando) => set({ digitando })} label="Mostrar digitando" />
        </div>
      </Secao>
    </>
  );
}
