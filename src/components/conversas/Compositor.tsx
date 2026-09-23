'use client';

// A caixa de digitar da conversa.
//
// Dentro da janela de 24 h: texto livre e anexo, como um WhatsApp normal.
// Fora dela a Meta recusa texto livre (erro 131047) — então o campo trava e oferece
// um template aprovado, que é a única coisa que pode abrir a conversa de novo.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WhatsAppTemplate } from '@/lib/types';
import { uploadMedia } from '@/lib/upload-client';
import { WA, acaoNaConversa } from './comum';

function tipoPorMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

interface Anexo {
  url: string;
  tipo: 'image' | 'video' | 'audio' | 'document';
  nome: string;
}

export function Compositor({
  conversaId,
  conexaoId,
  janelaAberta,
  onEnviado,
}: {
  conversaId: string;
  conexaoId: string | null;
  janelaAberta: boolean;
  onEnviado: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [pausar, setPausar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [subindo, setSubindo] = useState(false);
  // Fora da janela o template é a ÚNICA opção — derivado, não guardado: se a janela
  // fechar com a conversa aberta, o campo de texto trava na hora.
  const [pediuTemplate, setModoTemplate] = useState(false);
  const modoTemplate = pediuTemplate || !janelaAberta;
  const campo = useRef<HTMLTextAreaElement>(null);

  async function enviar() {
    if (enviando) return;
    const t = texto.trim();
    if (!t && !anexo) return;
    setEnviando(true);
    setErro(null);
    const e = anexo
      ? await acaoNaConversa(conversaId, { acao: 'midia', url: anexo.url, tipo: anexo.tipo, legenda: t || undefined, nome: anexo.nome })
      : await acaoNaConversa(conversaId, { acao: 'enviar', texto: t, pausarHoras: pausar ? 12 : 0 });
    setEnviando(false);
    if (e) {
      setErro(e);
      return;
    }
    setTexto('');
    setAnexo(null);
    onEnviado();
    campo.current?.focus();
  }

  async function anexar(f: File) {
    setSubindo(true);
    setErro(null);
    const r = await uploadMedia(f);
    setSubindo(false);
    if ('error' in r) {
      setErro(r.error);
      return;
    }
    setAnexo({ url: r.url, tipo: tipoPorMime(f.type), nome: f.name });
  }

  if (modoTemplate) {
    return (
      <SeletorTemplate
        conversaId={conversaId}
        conexaoId={conexaoId}
        janelaAberta={janelaAberta}
        onVoltar={janelaAberta ? () => setModoTemplate(false) : null}
        onEnviado={onEnviado}
      />
    );
  }

  return (
    <div style={{ background: WA.barra }}>
      {erro && (
        <div className="px-3 pt-2 text-[12.5px]" role="alert" style={{ color: WA.erroTexto }}>
          {erro}
        </div>
      )}
      {anexo && (
        <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]" style={{ background: '#2a3942' }}>
          <span aria-hidden="true">{anexo.tipo === 'image' ? '🖼️' : anexo.tipo === 'video' ? '🎬' : anexo.tipo === 'audio' ? '🎤' : '📄'}</span>
          <span className="min-w-0 flex-1 truncate">{anexo.nome}</span>
          <button type="button" onClick={() => setAnexo(null)} aria-label="Tirar anexo" className="px-1 text-lg" style={{ color: WA.cinza }}>
            ×
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5 px-2 pt-2">
        <label
          className={`shrink-0 cursor-pointer rounded-full px-2.5 py-2 text-lg leading-none hover:bg-white/10 ${subindo ? 'animate-pulse' : ''}`}
          title="Anexar foto, vídeo ou PDF"
        >
          📎<span className="sr-only">Anexar arquivo</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf"
            className="sr-only"
            disabled={subindo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void anexar(f);
            }}
          />
        </label>
        <textarea
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia, Shift+Enter quebra linha — como no WhatsApp Web.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void enviar();
            }
          }}
          rows={1}
          placeholder={anexo ? 'Legenda (opcional)' : 'Digite uma mensagem'}
          aria-label="Mensagem"
          className="max-h-40 min-h-[40px] min-w-0 flex-1 resize-none rounded-lg px-3 py-2.5 text-[14.5px] outline-none placeholder:text-[#8696a0]"
          style={{ background: '#2a3942', color: WA.texto, fieldSizing: 'content' } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={enviando || subindo || (!texto.trim() && !anexo)}
          aria-label="Enviar"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition-opacity disabled:cursor-not-allowed"
          style={{ background: texto.trim() || anexo ? WA.verde : 'transparent', color: texto.trim() || anexo ? WA.fundo : WA.cinza }}
        >
          {enviando ? '…' : '➤'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2 pt-1.5 text-[12px]" style={{ color: WA.cinza }}>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={pausar} onChange={(e) => setPausar(e.target.checked)} className="accent-[#00a884]" />
          Pausar o robô por 12 h ao responder
        </label>
        <button type="button" onClick={() => setModoTemplate(true)} className="underline underline-offset-2 hover:text-[#e9edef]">
          Mandar um template
        </button>
      </div>
    </div>
  );
}

function SeletorTemplate({
  conversaId,
  conexaoId,
  janelaAberta,
  onVoltar,
  onEnviado,
}: {
  conversaId: string;
  conexaoId: string | null;
  janelaAberta: boolean;
  onVoltar: (() => void) | null;
  onEnviado: () => void;
}) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<string>('');
  const [vars, setVars] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!conexaoId) return;
    let vivo = true;
    fetch(`/api/connections/${conexaoId}/templates`)
      .then(async (r) => {
        const b = (await r.json().catch(() => ({}))) as { templates?: WhatsAppTemplate[]; error?: string };
        if (!vivo) return;
        if (!r.ok) {
          setErroLista(b.error ?? 'Não consegui ler os templates.');
          setTemplates([]);
          return;
        }
        setTemplates((b.templates ?? []).filter((t) => t.status === 'APPROVED'));
      })
      .catch(() => {
        if (vivo) {
          setErroLista('Sem conexão com o servidor.');
          setTemplates([]);
        }
      });
    return () => {
      vivo = false;
    };
  }, [conexaoId]);

  const tpl = useMemo(() => templates?.find((t) => `${t.nome}|${t.idioma}` === escolhido) ?? null, [templates, escolhido]);
  const previa = tpl ? tpl.corpo.replace(/\{\{(\d+)\}\}/g, (m, n) => vars[Number(n) - 1]?.trim() || m) : '';
  const faltaVar = tpl ? vars.slice(0, tpl.variaveis_corpo).some((v) => !v?.trim()) || vars.length < tpl.variaveis_corpo : true;
  // Template com mídia no cabeçalho exige o link da mídia — esta tela não pede, então avisa.
  const temCabecalhoMidia = Boolean(tpl?.cabecalho_tipo && tpl.cabecalho_tipo !== 'TEXT');

  async function enviar() {
    if (!tpl || faltaVar) return;
    setEnviando(true);
    setErro(null);
    const e = await acaoNaConversa(conversaId, {
      acao: 'template',
      nome: tpl.nome,
      idioma: tpl.idioma,
      variaveis: vars.slice(0, tpl.variaveis_corpo).map((v) => v.trim()),
    });
    setEnviando(false);
    if (e) {
      setErro(e);
      return;
    }
    setEscolhido('');
    setVars([]);
    onEnviado();
  }

  return (
    <div className="max-h-[55%] overflow-y-auto px-3 py-2.5 text-[13px]" style={{ background: WA.barra }}>
      <div className="mb-2 flex items-start gap-2">
        <p className="min-w-0 flex-1 leading-relaxed" style={{ color: WA.cinza }}>
          {janelaAberta ? (
            'Template aprovado pela Meta — útil para retomar um assunto com o texto oficial.'
          ) : (
            <>
              <b style={{ color: WA.texto }}>A janela de 24 h está fechada.</b> A pessoa não escreve há mais de 24 h, então
              a Meta só aceita um <b style={{ color: WA.texto }}>template aprovado</b>. Quando ela responder, o texto livre volta.
            </>
          )}
        </p>
        {onVoltar && (
          <button type="button" onClick={onVoltar} className="shrink-0 underline underline-offset-2" style={{ color: WA.cinza }}>
            Voltar ao texto
          </button>
        )}
      </div>

      {!conexaoId ? (
        <p style={{ color: WA.erroTexto }}>O número desta conversa não está mais cadastrado.</p>
      ) : templates === null ? (
        <p style={{ color: WA.cinza }}>Carregando templates…</p>
      ) : templates.length === 0 ? (
        <p style={{ color: WA.erroTexto }}>
          {erroLista ?? 'Nenhum template aprovado neste número. Sincronize em Conexões → Templates → Buscar na Meta.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <select
            aria-label="Template"
            value={escolhido}
            onChange={(e) => {
              setEscolhido(e.target.value);
              setVars([]);
            }}
            className="w-full rounded-lg px-3 py-2 text-[13.5px] outline-none"
            style={{ background: '#2a3942', color: WA.texto }}
          >
            <option value="">Escolha um template…</option>
            {templates.map((t) => (
              <option key={t.id} value={`${t.nome}|${t.idioma}`}>
                {t.nome} · {t.idioma} · {t.categoria.toLowerCase()}
              </option>
            ))}
          </select>

          {tpl && (
            <>
              {Array.from({ length: tpl.variaveis_corpo }, (_, i) => (
                <input
                  key={i}
                  value={vars[i] ?? ''}
                  onChange={(e) => {
                    const n = [...vars];
                    n[i] = e.target.value;
                    setVars(n);
                  }}
                  placeholder={`Variável {{${i + 1}}}`}
                  aria-label={`Variável ${i + 1}`}
                  className="w-full rounded-lg px-3 py-2 text-[13.5px] outline-none placeholder:text-[#8696a0]"
                  style={{ background: '#2a3942', color: WA.texto }}
                />
              ))}
              <div className="rounded-lg rounded-tr-none px-2.5 py-2 text-[13.5px] leading-[1.4]" style={{ background: WA.saida }}>
                <div className="whitespace-pre-wrap break-words">{previa}</div>
                {tpl.rodape && (
                  <div className="mt-1 text-[12px]" style={{ color: '#8fb9ae' }}>
                    {tpl.rodape}
                  </div>
                )}
              </div>
              {temCabecalhoMidia && (
                <p className="text-[12px]" style={{ color: WA.erroTexto }}>
                  Este template tem {tpl.cabecalho_tipo === 'IMAGE' ? 'imagem' : tpl.cabecalho_tipo === 'VIDEO' ? 'vídeo' : 'documento'} no
                  cabeçalho, e esta tela não envia a mídia — a Meta deve recusar. Use um template só de texto aqui.
                </p>
              )}
              {erro && (
                <p role="alert" style={{ color: WA.erroTexto }}>
                  {erro}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void enviar()}
                  disabled={enviando || faltaVar}
                  className="rounded-full px-4 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: WA.verde, color: WA.fundo }}
                >
                  {enviando ? 'Enviando…' : faltaVar ? 'Preencha as variáveis' : 'Enviar template'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
