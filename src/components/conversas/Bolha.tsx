'use client';

// Um balão da conversa, no desenho do WhatsApp Web escuro.
//
// O que saiu (fluxo, atendente, campanha) é desenhado a partir do `payload` — o corpo
// exato que foi para a Meta —, então botões, lista e link aparecem como a pessoa viu.
// O que chegou vem cru da Meta; mídia recebida não tem link público (a Meta exige
// baixar com o token), por isso aparece como marcador com a legenda.

import type { MensagemConversa } from '@/lib/automacao/tipos';
import { WA, formatarTexto, horaDe } from './comum';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function Tiques({ m }: { m: MensagemConversa }) {
  if (m.status === 'falha') {
    return (
      <span title={m.erro ?? 'A Meta não entregou'} className="cursor-help" style={{ color: '#f15c6d' }}>
        ⚠ não entregue
      </span>
    );
  }
  if (m.status === 'lido') return <span title="Lida" style={{ color: WA.azul }}>✓✓</span>;
  if (m.status === 'entregue') return <span title="Entregue">✓✓</span>;
  if (m.status === 'enviado') return <span title="Enviada à Meta">✓</span>;
  return <span title="Saindo">🕓</span>;
}

const ORIGEM: Record<string, { rotulo: string; titulo: string }> = {
  fluxo: { rotulo: '🤖 fluxo', titulo: 'Enviada por uma automação' },
  manual: { rotulo: '👤 atendente', titulo: 'Enviada à mão, por esta tela' },
  campanha: { rotulo: '📣 campanha', titulo: 'Enviada por uma campanha' },
  teste: { rotulo: '🧪 teste', titulo: 'Teste do editor de fluxos' },
};

const ROTULO_MIDIA: Record<string, string> = {
  imagem: '🖼️ Imagem',
  video: '🎬 Vídeo',
  audio: '🎤 Áudio',
  documento: '📄 Documento',
  figurinha: '💟 Figurinha',
};
const CHAVE_META: Record<string, string> = { imagem: 'image', video: 'video', audio: 'audio', documento: 'document', figurinha: 'sticker' };

/** Mídia: a nossa tem link (mandamos por URL); a recebida só tem o id da Meta. */
function Midia({ m }: { m: MensagemConversa }) {
  const p = obj(m.payload);
  const dados = obj(p[CHAVE_META[m.tipo]]);
  const link = str(dados.link);
  const legenda = str(dados.caption);
  const nome = str(dados.filename);
  if (m.direcao === 'out' && link) {
    return (
      <>
        {m.tipo === 'imagem' ? (
          <a href={link} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={link} alt="" className="mb-1 max-h-72 w-full rounded-md object-cover" />
          </a>
        ) : m.tipo === 'video' ? (
          <video src={link} controls preload="metadata" className="mb-1 max-h-72 w-full rounded-md" />
        ) : m.tipo === 'audio' ? (
          <audio src={link} controls preload="none" className="mb-1 w-full min-w-[220px]" />
        ) : (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="mb-1 flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px]"
            style={{ background: 'rgba(0,0,0,.2)' }}
          >
            📄 <span className="truncate">{nome || 'Documento'}</span>
          </a>
        )}
        {legenda && <div className="whitespace-pre-wrap break-words">{formatarTexto(legenda)}</div>}
      </>
    );
  }
  return (
    <>
      <div className="mb-0.5 text-[12.5px] italic" style={{ color: '#aebac1' }}>
        {ROTULO_MIDIA[m.tipo] ?? 'Mídia'} {m.direcao === 'in' ? 'recebida' : 'enviada'}
        {nome ? ` · ${nome}` : ''}
      </div>
      {(legenda || (m.texto && !m.texto.startsWith('['))) && (
        <div className="whitespace-pre-wrap break-words">{formatarTexto(legenda || m.texto || '')}</div>
      )}
    </>
  );
}

/** Mensagem interativa que SAIU: texto + botões / lista / link, como a pessoa viu. */
function Interativa({ m }: { m: MensagemConversa }) {
  const i = obj(obj(m.payload).interactive);
  const cab = str(obj(i.header).text);
  const corpo = str(obj(i.body).text) || m.texto || '';
  const rodape = str(obj(i.footer).text);
  const acao = obj(i.action);
  const botoes = (Array.isArray(acao.buttons) ? acao.buttons : []).map((b) => str(obj(obj(b).reply).title));
  const secoes = Array.isArray(acao.sections) ? acao.sections : [];
  const link = obj(acao.parameters);
  return (
    <>
      {cab && <div className="mb-0.5 font-semibold">{cab}</div>}
      <div className="whitespace-pre-wrap break-words">{formatarTexto(corpo)}</div>
      {rodape && (
        <div className="mt-0.5 text-[12px]" style={{ color: '#8fb9ae' }}>
          {rodape}
        </div>
      )}
      {botoes.length > 0 && (
        <div className="-mx-2 mt-1.5 border-t" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
          {botoes.map((b, k) => (
            <div
              key={`${b}-${k}`}
              className="border-b py-1.5 text-center text-[13.5px] last:border-b-0"
              style={{ color: WA.azul, borderColor: 'rgba(255,255,255,.08)' }}
            >
              ↩ {b}
            </div>
          ))}
        </div>
      )}
      {i.type === 'list' && (
        <details className="-mx-2 mt-1.5 border-t" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
          <summary className="cursor-pointer list-none py-1.5 text-center text-[13.5px]" style={{ color: WA.azul }}>
            ☰ {str(acao.button) || 'Ver opções'}
          </summary>
          <ul className="px-2 pb-1 text-[13px]">
            {secoes.map((s, k) => {
              const sec = obj(s);
              const linhas = Array.isArray(sec.rows) ? sec.rows : [];
              return (
                <li key={k} className="mb-1">
                  {str(sec.title) && (
                    <div className="text-[11.5px] uppercase tracking-wide" style={{ color: '#8fb9ae' }}>
                      {str(sec.title)}
                    </div>
                  )}
                  {linhas.map((r, j) => {
                    const row = obj(r);
                    return (
                      <div key={j} className="py-0.5">
                        ○ {str(row.title)}
                        {str(row.description) && (
                          <span className="block pl-4 text-[12px]" style={{ color: '#8fb9ae' }}>
                            {str(row.description)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {i.type === 'cta_url' && str(link.url) && (
        <a
          href={str(link.url)}
          target="_blank"
          rel="noreferrer"
          className="-mx-2 mt-1.5 block border-t py-1.5 text-center text-[13.5px]"
          style={{ color: WA.azul, borderColor: 'rgba(255,255,255,.12)' }}
        >
          ↗ {str(link.display_text) || 'Abrir link'}
        </a>
      )}
    </>
  );
}

function Conteudo({ m }: { m: MensagemConversa }) {
  const texto = m.texto ?? '';
  switch (m.tipo) {
    case 'botoes':
    case 'lista':
    case 'link':
    case 'interativa':
      return m.direcao === 'out' ? <Interativa m={m} /> : <div className="whitespace-pre-wrap break-words">{formatarTexto(texto)}</div>;
    case 'template': {
      const botoes = Array.isArray(obj(m.payload).botoes) ? (obj(m.payload).botoes as unknown[]).map(String) : [];
      return (
        <>
          <div className="mb-1 inline-block rounded px-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ background: 'rgba(0,0,0,.25)', color: '#9fe8c9' }}>
            template {str(obj(m.payload).template)}
          </div>
          <div className="whitespace-pre-wrap break-words">{formatarTexto(texto)}</div>
          {botoes.length > 0 && (
            <div className="-mx-2 mt-1.5 border-t" style={{ borderColor: 'rgba(255,255,255,.12)' }}>
              {botoes.map((b) => (
                <div key={b} className="py-1.5 text-center text-[13.5px]" style={{ color: WA.azul }}>
                  ↩ {b}
                </div>
              ))}
            </div>
          )}
        </>
      );
    }
    case 'resposta_botao':
    case 'resposta_lista':
      return (
        <div className="flex items-center gap-1.5">
          <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: 'rgba(83,189,235,.15)', color: WA.azul }}>
            {m.tipo === 'resposta_botao' ? '↩ clicou' : '☰ escolheu'}
          </span>
          <span className="font-medium">{texto}</span>
        </div>
      );
    case 'imagem':
    case 'video':
    case 'audio':
    case 'documento':
    case 'figurinha':
      return <Midia m={m} />;
    case 'localizacao': {
      const loc = obj(obj(m.payload).location);
      const lat = loc.latitude;
      const lng = loc.longitude;
      return (
        <div>
          📍 {str(loc.name) || str(loc.address) || 'Localização'}
          {typeof lat === 'number' && typeof lng === 'number' && (
            <a
              href={`https://www.google.com/maps?q=${lat},${lng}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 underline"
              style={{ color: WA.azul }}
            >
              ver no mapa
            </a>
          )}
        </div>
      );
    }
    case 'contato':
      return <div className="italic" style={{ color: '#aebac1' }}>👤 Cartão de contato</div>;
    default:
      return texto ? (
        <div className="whitespace-pre-wrap break-words">{formatarTexto(texto)}</div>
      ) : (
        <div className="italic" style={{ color: '#aebac1' }}>Mensagem sem prévia</div>
      );
  }
}

export function Bolha({ m }: { m: MensagemConversa }) {
  // Reação: uma linha discreta no meio, não um balão.
  if (m.tipo === 'reacao') {
    return (
      <div className="my-1 text-center text-[12px]" style={{ color: WA.cinza }}>
        {m.direcao === 'in' ? 'Contato' : 'Você'} {m.texto || 'reagiu'}
      </div>
    );
  }
  const saiu = m.direcao === 'out';
  const origem = saiu && m.origem ? ORIGEM[m.origem] : null;
  return (
    <div className={`mb-1.5 flex ${saiu ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-lg px-2 pb-1 pt-1 text-[14px] leading-[1.4] shadow-sm sm:max-w-[70%] ${saiu ? 'rounded-tr-none' : 'rounded-tl-none'}`}
        style={{
          background: saiu ? WA.saida : WA.entrada,
          color: WA.texto,
          outline: m.status === 'falha' ? '1px solid #f15c6d' : undefined,
        }}
      >
        <Conteudo m={m} />
        <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-1.5 text-[11px]" style={{ color: saiu ? '#8fb9ae' : WA.cinza }}>
          {origem && (
            <span title={origem.titulo} className="opacity-90">
              {origem.rotulo}
            </span>
          )}
          <span>{horaDe(m.criado_em)}</span>
          {saiu && <Tiques m={m} />}
        </div>
        {m.status === 'falha' && m.erro && (
          <div className="mt-1 rounded px-1.5 py-1 text-[11.5px]" style={{ background: WA.erroFundo, color: WA.erroTexto }}>
            {m.erro}
          </div>
        )}
      </div>
    </div>
  );
}
