'use client';

import { useEffect, useState } from 'react';
import { linkDeReferencia, normalizarTexto } from '@/lib/automacao/montar';
import { Field, inputCls, Switch } from '@/components/ui';
import {
  api,
  ApagarInline,
  Aviso,
  AvisoFluxoInativo,
  btnPequeno,
  btnPrimario,
  btnSecundario,
  CampoCopiavel,
  Cartao,
  Chip,
  selectCls,
  SeletorFluxo,
  Vazio,
  type ConexaoOficial,
  type GatilhoLinha,
  type PropsAba,
} from './comum';

export function AbaLinks({ dados, recarregar }: PropsAba) {
  const [conexoes, setConexoes] = useState<ConexaoOficial[] | null>(null);
  const [numeroId, setNumeroId] = useState('');

  useEffect(() => {
    let vivo = true;
    api<{ conexoes: (ConexaoOficial & { provider: string })[] }>('/api/connections')
      .then((d) => {
        if (!vivo) return;
        const oficiais = (d.conexoes ?? []).filter((c) => c.provider === 'cloud' && c.numero);
        setConexoes(oficiais);
        setNumeroId(oficiais.find((c) => c.status === 'conectada')?.id ?? oficiais[0]?.id ?? '');
      })
      .catch(() => vivo && setConexoes([]));
    return () => {
      vivo = false;
    };
  }, []);

  const numero = conexoes?.find((c) => c.id === numeroId)?.numero ?? null;

  return (
    <div className="flex flex-col gap-8">
      <SecaoLinks dados={dados} recarregar={recarregar} numero={numero} conexoes={conexoes} numeroId={numeroId} setNumeroId={setNumeroId} />
      <SecaoAnuncios dados={dados} recarregar={recarregar} />
    </div>
  );
}

// ── Links de referência ──────────────────────────────────────────────────────────

function SecaoLinks({
  dados,
  recarregar,
  numero,
  conexoes,
  numeroId,
  setNumeroId,
}: PropsAba & {
  numero: string | null;
  conexoes: ConexaoOficial[] | null;
  numeroId: string;
  setNumeroId: (id: string) => void;
}) {
  const lista = dados.gatilhos.filter((g) => g.tipo === 'link_ref');
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">🔗 Links de referência</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">
            Um link <b className="text-ink">wa.me</b> que já abre a conversa com uma frase pronta e um código escondido. Quem
            chega por ele cai direto no fluxo escolhido — mesmo que já tenha conversado antes. Use no botão da LP, na bio do
            Instagram, nos stories ou num QR Code impresso.
          </p>
        </div>
        {editando !== 'novo' && (
          <button type="button" onClick={() => setEditando('novo')} className={`${btnPrimario} w-full sm:w-auto`}>
            + Novo link
          </button>
        )}
      </div>

      {conexoes && conexoes.length > 1 && (
        <div className="mb-3 max-w-sm">
          <label className="mb-1.5 block text-[12.5px] font-semibold" htmlFor="numero-link">
            Número dos links
          </label>
          <select id="numero-link" value={numeroId} onChange={(e) => setNumeroId(e.target.value)} className={selectCls}>
            {conexoes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} · +{c.numero}
              </option>
            ))}
          </select>
        </div>
      )}
      {conexoes && conexoes.length === 0 && (
        <div className="mb-3">
          <Aviso tom="info">
            Nenhum número oficial conectado ainda — os links aparecem assim que você conectar um em{' '}
            <a href="/conexoes" className="font-semibold underline underline-offset-2">
              Conexões
            </a>
            .
          </Aviso>
        </div>
      )}
      {erro && (
        <div className="mb-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}

      {editando === 'novo' && (
        <div className="mb-3">
          <FormLink
            dados={dados}
            onCancelar={() => setEditando(null)}
            onSalvar={async (cfg, fluxoId) => {
              await api('/api/gatilhos', { method: 'POST', json: { tipo: 'link_ref', fluxo_id: fluxoId, config: cfg } });
              await recarregar();
              setEditando(null);
            }}
          />
        </div>
      )}

      {lista.length === 0 && editando !== 'novo' ? (
        <Vazio>
          Nenhum link ainda. Exemplo: crie o código <b className="text-ink">live-peru</b> com a frase{' '}
          <i>&quot;Quero saber da live do Peru&quot;</i> e ponha o link no botão da LP da live.
        </Vazio>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {lista.map((g) =>
            editando === g.id ? (
              <FormLink
                key={g.id}
                dados={dados}
                inicial={g}
                onCancelar={() => setEditando(null)}
                onSalvar={async (cfg, fluxoId) => {
                  await api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { config: cfg, fluxo_id: fluxoId } });
                  await recarregar();
                  setEditando(null);
                }}
              />
            ) : (
              <Cartao key={g.id} className={g.ativo ? '' : 'opacity-70'}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[14px] font-semibold text-ink">{g.config.codigo}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      → <b className="text-ink">{g.fluxos?.nome ?? 'fluxo apagado'}</b> · {g.disparos}{' '}
                      {g.disparos === 1 ? 'pessoa chegou' : 'pessoas chegaram'}
                    </p>
                    <AvisoFluxoInativo g={g} />
                  </div>
                  <Switch
                    checked={g.ativo}
                    onChange={(v) => void rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { ativo: v } }))}
                    label="Ligar link"
                  />
                </div>
                {g.config.texto && <p className="mt-2 text-[13px] italic text-[#C9DCD8]">&quot;{g.config.texto}&quot;</p>}
                <div className="mt-3">
                  {numero ? (
                    <CampoCopiavel valor={linkDeReferencia(numero, g.config.codigo ?? '', g.config.texto)} />
                  ) : (
                    <p className="text-[12px] text-muted">Conecte um número oficial para gerar o link.</p>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <button type="button" onClick={() => setEditando(g.id)} className={btnPequeno}>
                    Editar
                  </button>
                  <ApagarInline onConfirmar={() => rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'DELETE' }))} />
                </div>
              </Cartao>
            ),
          )}
        </div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Dica: o código aparece no fim da mensagem como <code className="font-mono">[ref:codigo]</code>. Se a pessoa apagar
        esse pedaço antes de enviar, o link não é reconhecido e vale a boas-vindas.
      </p>
    </section>
  );
}

function FormLink({
  dados,
  inicial,
  onSalvar,
  onCancelar,
}: {
  dados: PropsAba['dados'];
  inicial?: GatilhoLinha;
  onSalvar: (cfg: { codigo: string; texto: string }, fluxoId: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [codigo, setCodigo] = useState(inicial?.config.codigo ?? '');
  const [texto, setTexto] = useState(inicial?.config.texto ?? '');
  const [fluxoId, setFluxoId] = useState(inicial?.fluxo_id ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    const c = normalizarTexto(codigo).replace(/\s+/g, '-');
    if (!/^[a-z0-9_-]{2,40}$/.test(c)) return setErro('O código usa letras, números e hífen (2 a 40). Ex.: live-peru');
    if (!fluxoId) return setErro('Escolha qual fluxo vai responder.');
    setOcupado(true);
    setErro(null);
    try {
      await onSalvar({ codigo: c, texto: texto.trim() }, fluxoId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  return (
    <Cartao className="border-blue2/40">
      <Field label="Código" hint="· curto, sem espaço (ex.: live-peru, lp-japao, bio)">
        <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="live-peru" className={inputCls} autoFocus />
      </Field>
      <Field label="Frase que já vem escrita" hint="· o que a pessoa vai enviar">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Quero saber da live do Peru" maxLength={200} className={inputCls} />
      </Field>
      <Field label="Fluxo que responde">
        <SeletorFluxo fluxos={dados.fluxos} valor={fluxoId} onChange={setFluxoId} />
      </Field>
      {erro && (
        <div className="mb-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={() => void salvar()} disabled={ocupado} className={`${btnPrimario} flex-1 sm:flex-none`}>
          {ocupado ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancelar} className={btnSecundario}>
          Cancelar
        </button>
      </div>
    </Cartao>
  );
}

// ── Anúncios de clique para o WhatsApp ───────────────────────────────────────────

function SecaoAnuncios({ dados, recarregar }: PropsAba) {
  const lista = dados.gatilhos.filter((g) => g.tipo === 'anuncio');
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function rodar(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">📣 Anúncios de clique para o WhatsApp</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">
            Quem clica num anúncio do Instagram/Facebook com destino WhatsApp chega com a identificação do anúncio. Escolha o
            fluxo para <b className="text-ink">qualquer anúncio</b> ou para anúncios específicos (pelo ID do anúncio no
            Gerenciador de Anúncios). O mais específico deve ficar acima — cadastre-o primeiro.
          </p>
        </div>
        {editando !== 'novo' && (
          <button type="button" onClick={() => setEditando('novo')} className={`${btnPrimario} w-full sm:w-auto`}>
            + Novo gatilho de anúncio
          </button>
        )}
      </div>
      {erro && (
        <div className="mb-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}
      {editando === 'novo' && (
        <div className="mb-3">
          <FormAnuncio
            dados={dados}
            onCancelar={() => setEditando(null)}
            onSalvar={async (ids, fluxoId) => {
              await api('/api/gatilhos', { method: 'POST', json: { tipo: 'anuncio', fluxo_id: fluxoId, config: { ad_ids: ids } } });
              await recarregar();
              setEditando(null);
            }}
          />
        </div>
      )}
      {lista.length === 0 && editando !== 'novo' ? (
        <Vazio>Nenhum gatilho de anúncio. Sem ele, quem vem do anúncio recebe a boas-vindas (se for a primeira conversa).</Vazio>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {lista.map((g) =>
            editando === g.id ? (
              <FormAnuncio
                key={g.id}
                dados={dados}
                inicial={g}
                onCancelar={() => setEditando(null)}
                onSalvar={async (ids, fluxoId) => {
                  await api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { config: { ad_ids: ids }, fluxo_id: fluxoId } });
                  await recarregar();
                  setEditando(null);
                }}
              />
            ) : (
              <Cartao key={g.id} className={g.ativo ? '' : 'opacity-70'}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-1.5">
                      {(g.config.ad_ids ?? []).length ? (
                        (g.config.ad_ids ?? []).map((id) => <Chip key={id}>{id}</Chip>)
                      ) : (
                        <Chip>Qualquer anúncio</Chip>
                      )}
                    </div>
                    <p className="mt-1.5 text-[12.5px] text-muted">
                      → <b className="text-ink">{g.fluxos?.nome ?? 'fluxo apagado'}</b> · {g.disparos} {g.disparos === 1 ? 'disparo' : 'disparos'}
                    </p>
                    <AvisoFluxoInativo g={g} />
                  </div>
                  <Switch
                    checked={g.ativo}
                    onChange={(v) => void rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'PATCH', json: { ativo: v } }))}
                    label="Ligar gatilho de anúncio"
                  />
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <button type="button" onClick={() => setEditando(g.id)} className={btnPequeno}>
                    Editar
                  </button>
                  <ApagarInline onConfirmar={() => rodar(() => api(`/api/gatilhos/${g.id}`, { method: 'DELETE' }))} />
                </div>
              </Cartao>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function FormAnuncio({
  dados,
  inicial,
  onSalvar,
  onCancelar,
}: {
  dados: PropsAba['dados'];
  inicial?: GatilhoLinha;
  onSalvar: (ids: string[], fluxoId: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [ids, setIds] = useState((inicial?.config.ad_ids ?? []).join(', '));
  const [fluxoId, setFluxoId] = useState(inicial?.fluxo_id ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    if (!fluxoId) return setErro('Escolha qual fluxo vai responder.');
    setOcupado(true);
    setErro(null);
    try {
      await onSalvar(
        ids
          .split(/[\s,;]+/)
          .map((x) => x.replace(/\D/g, ''))
          .filter(Boolean),
        fluxoId,
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  return (
    <Cartao className="border-blue2/40">
      <Field label="IDs dos anúncios" hint="· vazio = qualquer anúncio; separe por vírgula">
        <input value={ids} onChange={(e) => setIds(e.target.value)} placeholder="120212345678901234, 120298765432109876" className={inputCls} autoFocus />
      </Field>
      <Field label="Fluxo que responde">
        <SeletorFluxo fluxos={dados.fluxos} valor={fluxoId} onChange={setFluxoId} />
      </Field>
      {erro && (
        <div className="mb-3">
          <Aviso>{erro}</Aviso>
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={() => void salvar()} disabled={ocupado} className={`${btnPrimario} flex-1 sm:flex-none`}>
          {ocupado ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancelar} className={btnSecundario}>
          Cancelar
        </button>
      </div>
    </Cartao>
  );
}
