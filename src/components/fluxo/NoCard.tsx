'use client';

// O cartão de cada bloco no canvas — a "bolha" do ManyChat.
//
// Em cima, o que a pessoa vai VER no WhatsApp (bolhas, botões, mídia) ou, nos blocos
// de lógica, uma frase curta do que ele faz. Embaixo, uma linha por SAÍDA, com a
// bolinha de onde sai a seta e quantas pessoas já passaram por ela. As saídas vêm de
// `saidasDoNo` — a mesma função que o motor usa para decidir o próximo passo.

import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps, type Node } from '@xyflow/react';
import { ROTULO_TIPO, saidasDoNo, type Acao, type No, type Regra } from '@/lib/automacao/tipos';
import { COR, ICONE, useEditor, type DadosRF } from './contexto';

type NoRF = Node<DadosRF, 'bloco'>;

const MIDIA: Record<string, string> = { imagem: '🖼️ Imagem', video: '🎬 Vídeo', audio: '🎧 Áudio', documento: '📄 Documento' };

function Bolha({ children, vazio }: { children: React.ReactNode; vazio?: boolean }) {
  return (
    <div
      className={`rounded-lg rounded-tl-sm px-2.5 py-1.5 text-[12px] leading-snug ${
        vazio ? 'border border-dashed border-border text-muted/70 italic' : 'bg-[#1f2c34] text-[#e9edef]'
      }`}
    >
      <div className="line-clamp-5 whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

/** "*negrito*" do WhatsApp aparece sem os asteriscos na prévia. */
function limpar(t: string) {
  return t.replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1');
}

const OPERADOR: Record<string, string> = {
  tem: 'tem',
  nao_tem: 'não tem',
  igual: '=',
  diferente: '≠',
  contem: 'contém',
  nao_contem: 'não contém',
  vazio: 'está vazio',
  preenchido: 'está preenchido',
  maior: '>',
  menor: '<',
};

export function resumoRegra(r: Regra): string {
  const campo =
    r.campo === 'tag'
      ? 'Tag'
      : r.campo === 'campo'
        ? r.chave || 'campo'
        : r.campo === 'janela_aberta'
          ? 'Janela de 24 h aberta'
          : r.campo === 'inscrito_whatsapp'
            ? 'Inscrito no WhatsApp'
            : r.campo;
  if (r.campo === 'janela_aberta' || r.campo === 'inscrito_whatsapp') {
    return r.operador === 'nao_tem' || r.operador === 'diferente' ? `${campo}: não` : `${campo}: sim`;
  }
  const semValor = r.operador === 'vazio' || r.operador === 'preenchido';
  return `${campo} ${OPERADOR[r.operador] ?? r.operador}${semValor ? '' : ` "${r.valor ?? ''}"`}`;
}

export function resumoAcao(a: Acao): string {
  switch (a.tipo) {
    case 'adicionar_tag':
      return `🏷️ + tag "${a.tag || '?'}"`;
    case 'remover_tag':
      return `🏷️ − tag "${a.tag || '?'}"`;
    case 'definir_campo':
      return `✏️ ${a.chave || '?'} = "${a.valor}"`;
    case 'limpar_campo':
      return `🧹 limpa ${a.chave || '?'}`;
    case 'adicionar_lista':
      return '📋 entra numa lista';
    case 'remover_lista':
      return '📋 sai de uma lista';
    case 'descadastrar':
      return '🚫 descadastra do WhatsApp';
    case 'reinscrever':
      return '✅ reinscreve no WhatsApp';
    case 'pausar_automacao':
      return `🙋 pausa o robô por ${a.horas} h`;
    case 'notificar_equipe':
      return `📧 avisa ${a.email || '(sem e-mail)'}`;
    case 'webhook':
      return '🔗 chama webhook';
    case 'parar_outros_fluxos':
      return '⛔ para outros fluxos';
  }
}

function Previa({ no }: { no: No }) {
  const { nomeFluxo } = useEditor();
  switch (no.tipo) {
    case 'inicio':
      return <p className="text-[12px] leading-snug text-muted">Começa quando um gatilho dispara: palavra-chave, boas-vindas, link, anúncio…</p>;
    case 'mensagem': {
      const d = no.dados;
      return (
        <div className="flex flex-col gap-1.5">
          {d.cabecalho && <div className="text-[11px] font-semibold text-[#e9edef]">{d.cabecalho}</div>}
          {d.blocos.length === 0 && <Bolha vazio>Mensagem vazia</Bolha>}
          {d.blocos.map((b, i) =>
            b.tipo === 'texto' ? (
              <Bolha key={i} vazio={!b.texto.trim()}>
                {b.texto.trim() ? limpar(b.texto) : 'Escreva o texto…'}
              </Bolha>
            ) : (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-[#1f2c34] px-2.5 py-2 text-[12px] text-[#e9edef]">
                <span className="truncate">{MIDIA[b.tipo]}</span>
                {!b.url && <span className="text-[11px] text-[#ffb183]">sem arquivo</span>}
              </div>
            ),
          )}
          {d.rodape && <div className="text-[10px] text-[#8696a0]">{d.rodape}</div>}
          {d.interacao.tipo === 'lista' && (
            <div className="rounded-md border border-[#2a3942] py-1 text-center text-[12px] font-medium text-[#53bdeb]">
              ☰ {d.interacao.rotuloBotao || 'Ver opções'}
            </div>
          )}
          {d.interacao.tipo === 'link' && (
            <div className="rounded-md border border-[#2a3942] py-1 text-center text-[12px] font-medium text-[#53bdeb]">
              ↗ {d.interacao.rotulo || 'Abrir link'}
            </div>
          )}
          {(d.esperarMinutos ?? 0) > 0 && (
            <div className="text-[10px] text-muted">Espera o clique por {d.esperarMinutos} min</div>
          )}
        </div>
      );
    }
    case 'template':
      return no.dados.nome ? (
        <div className="rounded-lg bg-[#1f2c34] px-2.5 py-2 text-[12px] text-[#e9edef]">
          <div className="font-mono text-[11px] text-[#53bdeb]">{no.dados.nome}</div>
          <div className="mt-0.5 text-[10px] text-[#8696a0]">
            {no.dados.idioma}
            {Object.keys(no.dados.variaveis).length ? ` · ${Object.keys(no.dados.variaveis).length} variáveis` : ''}
          </div>
        </div>
      ) : (
        <Bolha vazio>Escolha um template aprovado</Bolha>
      );
    case 'pergunta':
      return (
        <div className="flex flex-col gap-1.5">
          <Bolha vazio={!no.dados.pergunta.trim()}>{no.dados.pergunta.trim() ? limpar(no.dados.pergunta) : 'Escreva a pergunta…'}</Bolha>
          {(no.dados.sugestoes ?? []).filter(Boolean).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(no.dados.sugestoes ?? []).filter(Boolean).map((s, i) => (
                <span key={i} className="rounded-full border border-[#2a3942] px-2 py-0.5 text-[11px] text-[#53bdeb]">
                  {s}
                </span>
              ))}
            </div>
          )}
          <div className="text-[11px] text-muted">
            Guarda em: <b className="text-ink">{no.dados.salvarEm || '— (não guarda)'}</b>
          </div>
        </div>
      );
    case 'aguardar': {
      const d = no.dados;
      const u = d.quantidade === 1 ? { minutos: 'minuto', horas: 'hora', dias: 'dia' }[d.unidade] : d.unidade;
      return (
        <div className="text-[13px] text-ink">
          Espera <b>{d.quantidade} {u}</b>
          {d.janelaInicio && d.janelaFim && (
            <div className="mt-0.5 text-[11px] text-muted">
              e só segue entre {d.janelaInicio} e {d.janelaFim}
            </div>
          )}
        </div>
      );
    }
    case 'condicao':
      return (
        <div className="flex flex-col gap-1 text-[12px] text-ink">
          {no.dados.regras.length === 0 && <span className="text-muted">Sem regras</span>}
          {no.dados.regras.map((r, i) => (
            <div key={i} className="flex gap-1.5">
              {i > 0 && <span className="text-[10px] font-semibold uppercase text-muted">{no.dados.combinar === 'todas' ? 'e' : 'ou'}</span>}
              <span className="truncate">{resumoRegra(r)}</span>
            </div>
          ))}
        </div>
      );
    case 'acao':
      return (
        <div className="flex flex-col gap-1 text-[12px] text-ink">
          {no.dados.acoes.length === 0 && <span className="text-muted">Nenhuma ação ainda</span>}
          {no.dados.acoes.map((a, i) => (
            <span key={i} className="truncate">
              {resumoAcao(a)}
            </span>
          ))}
        </div>
      );
    case 'randomizador':
      return <p className="text-[12px] text-muted">Sorteia um caminho para cada pessoa, pelo peso.</p>;
    case 'ir_para':
      return (
        <p className="text-[12px] text-ink">
          Continua em: <b>{nomeFluxo(no.dados.fluxoId) ?? (no.dados.fluxoId ? '(fluxo apagado)' : 'escolha o fluxo')}</b>
        </p>
      );
    case 'fim':
      return <p className="text-[12px] text-muted">Encerra o fluxo para esta pessoa.</p>;
  }
}

function pct(n: number, total: number): string {
  if (!total) return '';
  return `${Math.round((n / total) * 100)}%`;
}

function NoCardBase({ id, data, selected }: NodeProps<NoRF>) {
  const { no } = data;
  const ed = useEditor();
  const saidas = useMemo(() => saidasDoNo(no), [no]);
  const chaveSaidas = saidas.map((s) => s.id).join('|');
  const atualizar = useUpdateNodeInternals();
  // Adicionar/remover um botão muda as bolinhas: o React Flow precisa re-medir.
  useEffect(() => {
    atualizar(id);
  }, [chaveSaidas, id, atualizar]);

  const st = ed.stats[id];
  const problema = ed.comProblema.has(id);
  const botoes = no.tipo === 'mensagem' && (no.dados.interacao.tipo === 'botoes' || no.dados.interacao.tipo === 'lista');

  return (
    <div
      className={`w-[272px] overflow-visible rounded-2xl border bg-surface shadow-[0_10px_30px_rgba(0,0,0,.35)] transition-[border-color,box-shadow] ${
        selected
          ? 'border-blue shadow-[0_0_0_3px_rgba(215,242,100,.18),0_10px_30px_rgba(0,0,0,.35)]'
          : problema
            ? 'border-orange/70'
            : 'border-border hover:border-blue2/60'
      }`}
    >
      {no.tipo !== 'inicio' && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="!h-3.5 !w-3.5 !border-2 !border-surface !bg-blue2"
          style={{ top: 26 }}
        />
      )}

      <div className="flex items-center gap-2 rounded-t-2xl border-b border-border px-3 py-2" style={{ boxShadow: `inset 0 3px 0 ${COR[no.tipo]}` }}>
        <span aria-hidden="true">{ICONE[no.tipo]}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{no.titulo || ROTULO_TIPO[no.tipo]}</span>
        {st && st.entrou > 0 && (
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums text-muted" title="Pessoas que passaram por aqui">
            👥 {st.entrou}
          </span>
        )}
        {st && st.erro > 0 && (
          <span className="rounded-full bg-orange/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#ffb183]" title="Erros neste bloco">
            ⚠ {st.erro}
          </span>
        )}
        {no.tipo !== 'inicio' && (
          <div className="nodrag flex opacity-60 hover:opacity-100">
            <button type="button" title="Duplicar bloco" onClick={() => ed.duplicar(id)} className="rounded px-1 text-[12px] text-muted hover:text-ink">
              ⧉
            </button>
            <button type="button" title="Apagar bloco" onClick={() => ed.apagar(id)} className="rounded px-1 text-[12px] text-muted hover:text-[#ffb183]">
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="px-3 py-2.5">
        <Previa no={no} />
        {st && st.enviou > 0 && (
          <div className="mt-2 text-[10px] tabular-nums text-muted">
            ✓ enviado {st.enviou}× {st.entrou ? `(${pct(st.enviou, st.entrou)} de quem entrou)` : ''}
          </div>
        )}
      </div>

      {saidas.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border py-2">
          {saidas.map((s) => {
            const ligada = ed.saidasLigadas.has(`${id}::${s.id}`);
            const n = st?.saidas[s.id] ?? 0;
            const pareceBotao = botoes && !s.secundaria;
            return (
              <div key={s.id} className="relative flex items-center justify-end gap-1.5 pl-3 pr-5">
                {!ligada && (
                  <button
                    type="button"
                    title="Criar o próximo bloco"
                    onClick={(e) => ed.abrirMenuSaida(id, s.id, e.clientX, e.clientY)}
                    className="nodrag mr-auto rounded-full border border-dashed border-border px-1.5 text-[11px] leading-5 text-muted hover:border-blue hover:text-ink"
                  >
                    +
                  </button>
                )}
                {n > 0 && (
                  <span className="text-[10px] tabular-nums text-muted" title={`${n} pessoas seguiram por aqui`}>
                    {n}
                    {st?.entrou ? ` · ${pct(n, st.entrou)}` : ''}
                  </span>
                )}
                <span
                  className={
                    pareceBotao
                      ? 'max-w-[190px] truncate rounded-md border border-[#2a3942] bg-[#1f2c34] px-2 py-0.5 text-[12px] font-medium text-[#53bdeb]'
                      : `max-w-[200px] truncate ${s.secundaria ? 'text-[10.5px] text-muted/80' : 'text-[12px] font-medium text-ink'}`
                  }
                >
                  {s.rotulo}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={s.id}
                  className={
                    s.secundaria
                      ? '!h-2.5 !w-2.5 !border-2 !border-surface !bg-muted'
                      : '!h-3.5 !w-3.5 !border-2 !border-surface !bg-blue'
                  }
                  style={{ right: -7 }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const NoCard = memo(NoCardBase);
