'use client';

// O painel da direita: quem é a pessoa (nome, e-mail, tags, campos personalizados) e em
// que automações ela está agora. Tudo editável ali mesmo — o atendente não sai da
// conversa para marcar uma tag.

import Link from 'next/link';
import { useState } from 'react';
import { formatarTelefone } from '@/lib/whatsapp/jid';
import {
  WA,
  ESTADO_EXECUCAO,
  EXECUCAO_ATIVA,
  acaoNaConversa,
  horaDe,
  rotuloDoDia,
  type CampoDef,
  type DetalheConversa,
} from './comum';

function CampoEditavel({
  rotulo,
  valor,
  tipo = 'text',
  placeholder,
  onSalvar,
}: {
  rotulo: string;
  valor: string;
  tipo?: string;
  placeholder?: string;
  onSalvar: (v: string) => Promise<string | null>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (rascunho.trim() === valor.trim()) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    const e = await onSalvar(rascunho.trim());
    setSalvando(false);
    if (e) setErro(e);
    else {
      setErro(null);
      setEditando(false);
    }
  }

  return (
    <div className="py-1.5">
      <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: WA.cinza }}>
        {rotulo}
      </div>
      {editando ? (
        <div className="mt-1 flex gap-1.5">
          <input
            type={tipo}
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void salvar();
              if (e.key === 'Escape') {
                setRascunho(valor);
                setEditando(false);
              }
            }}
            placeholder={placeholder}
            autoFocus
            aria-label={rotulo}
            className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[13.5px] outline-none"
            style={{ background: '#2a3942', color: WA.texto }}
          />
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando}
            className="shrink-0 rounded-md px-2.5 text-[12.5px] font-semibold"
            style={{ background: WA.verde, color: WA.fundo }}
          >
            {salvando ? '…' : 'OK'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRascunho(valor);
            setEditando(true);
          }}
          className="mt-0.5 block w-full truncate rounded text-left text-[14px] hover:bg-white/5"
          title="Clique para editar"
        >
          {valor || <span style={{ color: WA.cinza }}>— clique para preencher</span>}
        </button>
      )}
      {erro && (
        <div className="mt-1 text-[12px]" role="alert" style={{ color: WA.erroTexto }}>
          {erro}
        </div>
      )}
    </div>
  );
}

const TIPO_INPUT: Record<string, string> = { numero: 'number', data: 'date', email: 'email', telefone: 'tel' };

export function PainelContato({
  detalhe,
  campos,
  onMudou,
  onFechar,
}: {
  detalhe: DetalheConversa;
  campos: CampoDef[];
  onMudou: () => void;
  onFechar: () => void;
}) {
  const { conversa, contato, execucoes } = detalhe;
  const [novaTag, setNovaTag] = useState('');
  const [erroTag, setErroTag] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const salvarCampo = (chave: string) => async (valor: string) => {
    const e = await acaoNaConversa(conversa.id, { acao: 'campo', chave, valor });
    if (!e) onMudou();
    return e;
  };

  async function tag(t: string, remover = false) {
    if (!t.trim()) return;
    setOcupado(true);
    const e = await acaoNaConversa(conversa.id, { acao: 'tag', tag: t.trim(), remover });
    setOcupado(false);
    setErroTag(e);
    if (!e) {
      if (!remover) setNovaTag('');
      onMudou();
    }
  }

  const ativas = execucoes.filter((x) => EXECUCAO_ATIVA.has(x.estado));
  const recentes = execucoes.filter((x) => !EXECUCAO_ATIVA.has(x.estado)).slice(0, 5);

  return (
    <div className="flex h-full flex-col" style={{ background: WA.lista, color: WA.texto }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ background: WA.barra }}>
        <button
          type="button"
          onClick={onFechar}
          className="rounded-full px-2 py-1 text-lg hover:bg-white/10"
          aria-label="Fechar dados do contato"
        >
          ×
        </button>
        <h2 className="text-[15px] font-semibold">Dados do contato</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!contato ? (
          <p className="text-[13px]" style={{ color: WA.cinza }}>
            Esta conversa ainda não está ligada a um contato da base.
          </p>
        ) : (
          <>
            {contato.status_whatsapp === 'descadastrado' && (
              <div className="mb-3 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed" style={{ background: WA.erroFundo, color: WA.erroTexto }}>
                <b>Pediu para sair.</b> Nenhuma automação nem campanha manda WhatsApp para esta pessoa. Responder à mão
                ainda é possível enquanto a janela de 24 h estiver aberta.
              </div>
            )}

            <CampoEditavel rotulo="Nome" valor={contato.nome ?? ''} onSalvar={salvarCampo('nome')} />
            <div className="py-1.5">
              <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: WA.cinza }}>
                WhatsApp
              </div>
              <div className="mt-0.5 text-[14px]">{formatarTelefone(conversa.wa_id)}</div>
            </div>
            <CampoEditavel rotulo="E-mail" tipo="email" valor={contato.email ?? ''} onSalvar={salvarCampo('email')} />

            <section className="mt-3 border-t pt-3" style={{ borderColor: WA.linha }}>
              <h3 className="mb-2 text-[11px] uppercase tracking-[0.08em]" style={{ color: WA.cinza }}>
                Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {(contato.tags ?? []).length === 0 && (
                  <span className="text-[12.5px]" style={{ color: WA.cinza }}>
                    Sem tags.
                  </span>
                )}
                {(contato.tags ?? []).map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px]" style={{ background: '#0a332c', color: '#d9fdd3' }}>
                    {t}
                    <button
                      type="button"
                      onClick={() => void tag(t, true)}
                      disabled={ocupado}
                      aria-label={`Tirar a tag ${t}`}
                      className="leading-none opacity-70 hover:opacity-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <form
                className="mt-2 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void tag(novaTag);
                }}
              >
                <input
                  value={novaTag}
                  onChange={(e) => setNovaTag(e.target.value)}
                  placeholder="Nova tag"
                  aria-label="Nova tag"
                  className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-[13px] outline-none placeholder:text-[#8696a0]"
                  style={{ background: '#2a3942', color: WA.texto }}
                />
                <button
                  type="submit"
                  disabled={ocupado || !novaTag.trim()}
                  className="shrink-0 rounded-md px-2.5 text-[12.5px] font-semibold disabled:opacity-50"
                  style={{ background: WA.verde, color: WA.fundo }}
                >
                  Pôr
                </button>
              </form>
              {erroTag && (
                <div className="mt-1 text-[12px]" role="alert" style={{ color: WA.erroTexto }}>
                  {erroTag}
                </div>
              )}
            </section>

            <section className="mt-3 border-t pt-3" style={{ borderColor: WA.linha }}>
              <h3 className="mb-1 text-[11px] uppercase tracking-[0.08em]" style={{ color: WA.cinza }}>
                Campos personalizados
              </h3>
              {campos.length === 0 ? (
                <p className="text-[12.5px] leading-relaxed" style={{ color: WA.cinza }}>
                  Nenhum campo criado. Crie em <Link href="/automacoes" className="underline">Automações → Campos</Link> para
                  guardar destino, orçamento, data da viagem…
                </p>
              ) : (
                campos.map((c) =>
                  c.tipo === 'sim_nao' ? (
                    <div key={c.id} className="py-1.5">
                      <div className="text-[11px] uppercase tracking-[0.08em]" style={{ color: WA.cinza }}>
                        {c.rotulo}
                      </div>
                      <select
                        value={String(contato.campos?.[c.chave] ?? '')}
                        onChange={(e) => void salvarCampo(c.chave)(e.target.value)}
                        aria-label={c.rotulo}
                        className="mt-1 w-full rounded-md px-2 py-1.5 text-[13.5px] outline-none"
                        style={{ background: '#2a3942', color: WA.texto }}
                      >
                        <option value="">—</option>
                        <option value="sim">Sim</option>
                        <option value="nao">Não</option>
                      </select>
                    </div>
                  ) : (
                    <CampoEditavel
                      key={c.id}
                      rotulo={c.rotulo}
                      tipo={TIPO_INPUT[c.tipo] ?? 'text'}
                      valor={String(contato.campos?.[c.chave] ?? '')}
                      onSalvar={salvarCampo(c.chave)}
                    />
                  ),
                )
              )}
            </section>
          </>
        )}

        <section className="mt-3 border-t pt-3" style={{ borderColor: WA.linha }}>
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.08em]" style={{ color: WA.cinza }}>
            Automações
          </h3>
          {ativas.length === 0 && recentes.length === 0 && (
            <p className="text-[12.5px]" style={{ color: WA.cinza }}>
              Nenhum fluxo passou por esta conversa ainda.
            </p>
          )}
          {[...ativas, ...recentes].map((x) => (
            <Link
              key={x.id}
              href={`/automacoes/${x.fluxo_id}`}
              className="mb-1.5 block rounded-lg px-3 py-2 text-[13px] transition-colors hover:bg-white/5"
              style={{ background: EXECUCAO_ATIVA.has(x.estado) ? '#0a332c' : '#1a262d' }}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{x.fluxos?.nome ?? 'Fluxo apagado'}</span>
                <span className="shrink-0 text-[11.5px]" style={{ color: x.estado === 'erro' ? '#f15c6d' : EXECUCAO_ATIVA.has(x.estado) ? '#9fe8c9' : WA.cinza }}>
                  {ESTADO_EXECUCAO[x.estado] ?? x.estado}
                  {x.estado === 'aguardando_tempo' && x.acordar_em ? ` até ${rotuloDoDia(x.acordar_em)} ${horaDe(x.acordar_em)}` : ''}
                </span>
              </div>
              {x.erro && (
                <div className="mt-0.5 text-[12px]" style={{ color: x.estado === 'erro' ? WA.erroTexto : WA.cinza }}>
                  {x.erro}
                </div>
              )}
            </Link>
          ))}
        </section>

        {contato && (
          <Link href="/contatos" className="mt-4 block text-center text-[12.5px] underline underline-offset-2" style={{ color: WA.cinza }}>
            Abrir a base de contatos ›
          </Link>
        )}
      </div>
    </div>
  );
}
