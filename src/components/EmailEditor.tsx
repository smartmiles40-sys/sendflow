'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailCampaign, EmailTemplate, Lista } from '@/lib/types';
import { Field, inputCls, SegButton } from '@/components/ui';
import { formatarNumero } from '@/lib/kpis';

/**
 * Editor de campanha de e-mail.
 *
 * Três decisões de produto que valem explicar:
 *
 * 1. O corpo é HTML, com modelos prontos. Um editor de arrastar-e-soltar seria mais
 *    amigável, mas custa semanas e engessa o resultado; começar de um modelo testado
 *    e mexer no texto resolve 95% dos casos sem nada disso.
 * 2. A prévia roda num iframe ISOLADO (sandbox, sem permissão de script). O HTML aqui
 *    é editável por quem usa e, no futuro, colável de qualquer lugar — renderizar isso
 *    direto na página deixaria um <script> colado por engano rodar dentro do painel,
 *    com acesso à sessão.
 * 3. Enviar é sempre em DOIS passos: manda um teste para você, confere na caixa de
 *    entrada, só então agenda. E-mail enviado não volta.
 */

const VARIAVEIS = [
  { chave: 'nome', descricao: 'Nome completo do contato' },
  { chave: 'primeiro_nome', descricao: 'Só o primeiro nome' },
  { chave: 'email', descricao: 'E-mail do contato' },
  { chave: 'empresa', descricao: 'Empresa do contato' },
  { chave: 'rodape', descricao: 'Rodapé com o link de descadastro (obrigatório por lei e por entregabilidade)' },
];

export interface DadosEditor {
  campanha: EmailCampaign | null;
  listas: Lista[];
  modelos: EmailTemplate[];
  remetentePadrao: { nome: string; email: string; responder_para: string };
  provedor: string | null;
}

export function EmailEditor({ dados }: { dados: DadosEditor }) {
  const router = useRouter();
  const c = dados.campanha;

  const [nome, setNome] = useState(c?.nome ?? '');
  const [assunto, setAssunto] = useState(c?.assunto ?? '');
  const [assuntoB, setAssuntoB] = useState(c?.assunto_b ?? '');
  const [testeAB, setTesteAB] = useState(Boolean(c?.assunto_b));
  const [preheader, setPreheader] = useState(c?.preheader ?? '');
  const [remetenteNome, setRemetenteNome] = useState(c?.remetente_nome ?? dados.remetentePadrao.nome);
  const [remetenteEmail, setRemetenteEmail] = useState(c?.remetente_email ?? dados.remetentePadrao.email);
  const [responderPara, setResponderPara] = useState(c?.responder_para ?? dados.remetentePadrao.responder_para);
  const [html, setHtml] = useState(c?.html ?? '');
  const [listIds, setListIds] = useState<string[]>(c?.list_ids ?? []);
  const [agendar, setAgendar] = useState(Boolean(c?.enviar_em && c?.status === 'agendada'));
  const [enviarEm, setEnviarEm] = useState(paraCampoLocal(c?.enviar_em));

  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [avisoGeral, setAvisoGeral] = useState<string | null>(null);
  const [emailTeste, setEmailTeste] = useState('');
  const [resultadoTeste, setResultadoTeste] = useState<string | null>(null);
  const [enviandoTeste, setEnviandoTeste] = useState(false);

  const totalPublico = useMemo(
    () => dados.listas.filter((l) => listIds.includes(l.id)).reduce((t, l) => t + (l.total ?? 0), 0),
    [dados.listas, listIds],
  );

  async function salvar(comoAgendada: boolean) {
    setSalvando(true);
    setErros({});
    setAvisoGeral(null);
    try {
      const corpo = {
        nome,
        assunto,
        assunto_b: testeAB ? assuntoB : '',
        preheader,
        remetente_nome: remetenteNome,
        remetente_email: remetenteEmail,
        responder_para: responderPara,
        html,
        list_ids: listIds,
        agendar: comoAgendada,
        enviar_em: comoAgendada && agendar ? new Date(enviarEm).toISOString() : comoAgendada ? new Date().toISOString() : null,
        ...(comoAgendada ? {} : { status: 'rascunho' }),
      };
      const res = await fetch(c ? `/api/email/campaigns/${c.id}` : '/api/email/campaigns', {
        method: c ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(body.errors)) {
          setErros(Object.fromEntries(body.errors.map((e: { field: string; message: string }) => [e.field, e.message])));
          setAvisoGeral('Confira os campos destacados.');
        } else {
          setAvisoGeral(body.error ?? 'Não foi possível salvar.');
        }
        return;
      }
      router.push(comoAgendada ? `/email/${body.id ?? c?.id}` : '/email');
      router.refresh();
    } catch {
      setAvisoGeral('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  async function enviarTeste() {
    if (!c) {
      setResultadoTeste('Salve o rascunho antes de mandar o teste.');
      return;
    }
    setEnviandoTeste(true);
    setResultadoTeste(null);
    try {
      const res = await fetch(`/api/email/campaigns/${c.id}/teste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ para: emailTeste }),
      });
      const body = await res.json().catch(() => ({}));
      setResultadoTeste(
        res.ok
          ? `Teste enviado para ${emailTeste} via ${body.provedor}. Confira a caixa de entrada (e o spam).`
          : (body.error ?? body.errors?.[0]?.message ?? 'Não foi possível enviar o teste.'),
      );
    } finally {
      setEnviandoTeste(false);
    }
  }

  const podeAgendar = Boolean(nome && assunto && html.trim() && listIds.length && remetenteEmail);

  return (
    <div className="max-w-6xl">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">
          {c ? 'Editar campanha de e-mail' : 'Nova campanha de e-mail'}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          O sistema mede abertura, clique, bounce e descadastro de cada pessoa — e mostra tudo no
          painel depois do envio.
        </p>
      </header>

      {!dados.provedor && (
        <div
          role="alert"
          className="mb-6 rounded-xl2 border border-orange/30 bg-orange/[0.08] p-5 text-sm leading-relaxed text-[#ffb183]"
        >
          <strong className="font-semibold">Nenhum provedor de e-mail configurado.</strong> Dá para
          escrever e salvar o rascunho, mas não para enviar. Configure{' '}
          <code className="font-mono text-xs">RESEND_API_KEY</code> ou as variáveis{' '}
          <code className="font-mono text-xs">SMTP_*</code> — o passo a passo está em{' '}
          <code className="font-mono text-xs">docs/EMAIL.md</code>.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-5">
          <Bloco titulo="Identificação">
            <Field label="Nome da campanha" hint="(interno — ninguém que recebe vê)" error={erros.nome}>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Newsletter de setembro"
                className={inputCls}
              />
            </Field>

            <Field
              label="Assunto"
              hint="o que mais decide se o e-mail é aberto"
              error={erros.assunto}
            >
              <input
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
                placeholder="Sua vaga na aula de quinta"
                className={inputCls}
                maxLength={200}
              />
              <ContadorAssunto texto={assunto} />
            </Field>

            <div className="mb-5">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={testeAB}
                  onChange={(e) => setTesteAB(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#D7F264]"
                />
                <span>
                  <b>Testar dois assuntos (A/B)</b>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                    Metade da lista recebe o assunto A e metade o B, sorteados de forma alternada. O
                    painel mostra qual ganhou em abertura — é a forma mais barata de aprender o que
                    funciona com o seu público.
                  </span>
                </span>
              </label>
              {testeAB && (
                <div className="mt-3">
                  <input
                    value={assuntoB}
                    onChange={(e) => setAssuntoB(e.target.value)}
                    placeholder="Assunto B — tente algo bem diferente do A"
                    className={inputCls}
                    maxLength={200}
                  />
                  {erros.assunto_b && <p className="mt-1.5 text-xs text-[#ffb183]">{erros.assunto_b}</p>}
                </div>
              )}
            </div>

            <Field
              label="Preheader"
              hint="o trecho cinza que aparece depois do assunto na caixa de entrada"
            >
              <input
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                placeholder="Quinta, 19h30 — com gravação para quem não puder assistir"
                className={inputCls}
                maxLength={160}
              />
            </Field>
          </Bloco>

          <Bloco titulo="Remetente">
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Nome que aparece" error={erros.remetente_nome}>
                <input
                  value={remetenteNome}
                  onChange={(e) => setRemetenteNome(e.target.value)}
                  placeholder="Equipe Se Tu For, Eu Vou"
                  className={inputCls}
                />
              </Field>
              <Field label="E-mail de envio" error={erros.remetente_email}>
                <input
                  value={remetenteEmail}
                  onChange={(e) => setRemetenteEmail(e.target.value)}
                  placeholder="contato@suaempresa.com.br"
                  className={inputCls}
                />
              </Field>
            </div>
            <Field
              label="Responder para"
              hint="(opcional — para onde vão as respostas, se for outro endereço)"
              error={erros.responder_para}
            >
              <input
                value={responderPara}
                onChange={(e) => setResponderPara(e.target.value)}
                placeholder="comercial@suaempresa.com.br"
                className={inputCls}
              />
            </Field>
          </Bloco>

          <Bloco titulo="Conteúdo">
            <ModelosProntos
              modelos={dados.modelos}
              temConteudo={Boolean(html.trim())}
              onEscolher={(m) => {
                setHtml(m.html);
                if (!assunto && m.assunto_sugerido) setAssunto(m.assunto_sugerido);
              }}
            />

            <Field label="HTML do e-mail" error={erros.html}>
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                rows={14}
                spellCheck={false}
                placeholder="Escolha um modelo acima, ou cole o HTML aqui."
                className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
              />
            </Field>

            <Variaveis onInserir={(v) => setHtml((h) => `${h}{{${v}}}`)} />
          </Bloco>

          <Bloco titulo="Quem vai receber">
            {dados.listas.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhuma lista cadastrada. Crie uma em <b>Contatos e listas</b> e importe seu CSV.
              </p>
            ) : (
              <>
                <div className="mb-4 flex flex-col gap-2">
                  {dados.listas.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface2 px-3.5 py-3 text-sm transition-colors hover:border-blue2"
                    >
                      <input
                        type="checkbox"
                        checked={listIds.includes(l.id)}
                        onChange={(e) =>
                          setListIds((atual) =>
                            e.target.checked ? [...atual, l.id] : atual.filter((x) => x !== l.id),
                          )
                        }
                        className="h-4 w-4 accent-[#D7F264]"
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: l.cor }}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate">{l.nome}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {formatarNumero(l.total ?? 0)} contatos
                      </span>
                    </label>
                  ))}
                </div>
                {erros.list_ids && <p className="mb-3 text-xs text-[#ffb183]">{erros.list_ids}</p>}
                <p className="text-xs leading-relaxed text-muted">
                  <b className="text-ink">{formatarNumero(totalPublico)}</b> contatos nas listas
                  escolhidas. Quem descadastrou, deu bounce ou marcou como spam é descartado na hora
                  do envio — e a mesma pessoa em duas listas recebe uma vez só.
                </p>
              </>
            )}
          </Bloco>

          <Bloco titulo="Quando enviar">
            <div className="mb-4 flex gap-2.5">
              <SegButton on={!agendar} onClick={() => setAgendar(false)}>
                Enviar agora
              </SegButton>
              <SegButton on={agendar} onClick={() => setAgendar(true)}>
                Agendar
              </SegButton>
            </div>
            {agendar && (
              <Field label="Data e hora" error={erros.enviar_em}>
                <input
                  type="datetime-local"
                  value={enviarEm}
                  onChange={(e) => setEnviarEm(e.target.value)}
                  className={inputCls}
                />
              </Field>
            )}
          </Bloco>

          {avisoGeral && (
            <div role="alert" className="rounded-xl border border-orange/30 bg-orange/[0.08] px-3.5 py-3 text-sm text-[#ffb183]">
              {avisoGeral}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void salvar(false)}
              disabled={salvando || !nome.trim()}
              className="rounded-xl border border-border px-5 py-3 text-sm font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:opacity-50"
            >
              Salvar rascunho
            </button>
            <button
              type="button"
              onClick={() => {
                const quantos = formatarNumero(totalPublico);
                if (
                  window.confirm(
                    agendar
                      ? `Agendar o envio para cerca de ${quantos} contatos?`
                      : `Enviar AGORA para cerca de ${quantos} contatos? E-mail enviado não volta.`,
                  )
                ) {
                  void salvar(true);
                }
              }}
              disabled={salvando || !podeAgendar || !dados.provedor}
              className="rounded-xl bg-blue px-6 py-3 text-sm font-semibold text-on-blue shadow-[0_6px_20px_rgba(215,242,100,.22)] transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:bg-surface2 disabled:text-muted disabled:shadow-none"
            >
              {salvando ? 'Salvando…' : agendar ? 'Agendar envio' : 'Enviar agora'}
            </button>
          </div>
        </div>

        {/* Coluna direita: prévia + teste. Fica grudada ao rolar, para a pessoa ver o
            efeito de cada mudança sem subir e descer a página. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Previa html={html} assunto={assunto} preheader={preheader} remetente={remetenteNome} />

          <div className="mt-4 rounded-xl2 border border-border bg-surface p-5">
            <h3 className="mb-1.5 text-[13px] font-semibold">Mande um teste para você</h3>
            <p className="mb-3.5 text-xs leading-relaxed text-muted">
              A prévia acima é uma aproximação. O que vale é ver na caixa de entrada de verdade: o
              assunto, o remetente, se caiu em Promoções e se os links funcionam. O teste{' '}
              <b className="text-ink">não entra nos números</b> da campanha.
            </p>
            <div className="flex gap-2">
              <input
                value={emailTeste}
                onChange={(e) => setEmailTeste(e.target.value)}
                placeholder="voce@empresa.com.br"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => void enviarTeste()}
                disabled={enviandoTeste || !emailTeste || !dados.provedor}
                className="shrink-0 rounded-xl border border-border px-4 py-3 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink disabled:opacity-50"
              >
                {enviandoTeste ? '…' : 'Enviar'}
              </button>
            </div>
            {resultadoTeste && <p className="mt-2.5 text-xs leading-relaxed text-muted">{resultadoTeste}</p>}
            {!c && (
              <p className="mt-2.5 text-xs text-muted">
                Salve o rascunho primeiro para liberar o teste.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl2 border border-border bg-surface p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{titulo}</h2>
      {children}
    </section>
  );
}

/**
 * O assunto é o campo que mais decide a taxa de abertura, então ele ganha um medidor.
 * O corte em ~45 caracteres é onde o celular costuma truncar — e a maioria abre no celular.
 */
function ContadorAssunto({ texto }: { texto: string }) {
  const n = texto.length;
  if (!n) return null;
  const aviso =
    n > 60
      ? 'longo demais: o celular vai cortar o final'
      : n > 45
        ? 'já está no limite do que aparece no celular'
        : 'bom tamanho para celular';
  return (
    <p className="mt-1.5 text-xs text-muted">
      {n} caracteres — {aviso}
    </p>
  );
}

function ModelosProntos({
  modelos,
  temConteudo,
  onEscolher,
}: {
  modelos: EmailTemplate[];
  temConteudo: boolean;
  onEscolher: (m: EmailTemplate) => void;
}) {
  if (!modelos.length) return null;
  return (
    <div className="mb-5">
      <span className="mb-[9px] block text-[13px] font-semibold">Começar de um modelo</span>
      <div className="flex flex-col gap-2">
        {modelos.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              if (temConteudo && !window.confirm('Isso substitui o conteúdo atual. Continuar?')) return;
              onEscolher(m);
            }}
            className="rounded-xl border border-border bg-surface2 px-3.5 py-3 text-left transition-colors hover:border-blue2"
          >
            <span className="block text-sm font-semibold">{m.nome}</span>
            {m.descricao && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{m.descricao}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Variaveis({ onInserir }: { onInserir: (v: string) => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface2 p-3.5">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        Variáveis
      </span>
      <p className="mb-2.5 text-xs leading-relaxed text-muted">
        Escreva no texto para personalizar. Variável sem valor vira vazio — nunca aparece{' '}
        <code className="font-mono">{'{{nome}}'}</code> na tela de quem recebe.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {VARIAVEIS.map((v) => (
          <button
            key={v.chave}
            type="button"
            title={v.descricao}
            onClick={() => onInserir(v.chave)}
            className="rounded-lg border border-border px-2.5 py-1.5 font-mono text-[11px] text-muted transition-colors hover:border-blue2 hover:text-ink"
          >
            {`{{${v.chave}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function Previa({
  html,
  assunto,
  preheader,
  remetente,
}: {
  html: string;
  assunto: string;
  preheader: string;
  remetente: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);

  // `srcdoc` com sandbox vazio: o HTML renderiza, mas não roda script, não navega e
  // não alcança nada do painel. É o que permite deixar o corpo do e-mail editável
  // sem transformar a prévia numa porta de entrada.
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"></head><body style="margin:0;background:#f4f6fb;">${html}</body></html>`;
  }, [html]);

  return (
    <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          Como chega na caixa de entrada
        </div>
        <div className="mt-2.5 rounded-xl bg-surface2 px-3.5 py-3">
          <div className="text-[13px] font-semibold text-ink">{remetente || 'Remetente'}</div>
          <div className="truncate text-[13px] text-ink">{assunto || 'Assunto do e-mail'}</div>
          <div className="truncate text-xs text-muted">
            {preheader || 'O preheader aparece aqui, em cinza.'}
          </div>
        </div>
      </div>
      <iframe
        ref={ref}
        title="Prévia do e-mail"
        sandbox=""
        className="block h-[440px] w-full border-0 bg-white"
      />
    </div>
  );
}

/** ISO → o formato que o `datetime-local` entende, no relógio de quem está olhando. */
function paraCampoLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
