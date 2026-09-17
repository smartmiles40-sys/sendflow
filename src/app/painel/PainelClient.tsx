'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DadosPainel } from '@/lib/painel';
import { SerieDiaria, ROTULO_METRICA, type Metrica } from '@/components/charts/SerieDiaria';
import { Funil } from '@/components/charts/Funil';
import { Tile } from '@/components/charts/Tile';
import { avaliar, conselho, formatarDuracao, formatarNumero, formatarTaxa, REFERENCIAS } from '@/lib/kpis';
import { formatWhen } from '@/lib/format';

const PERIODOS = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

const METRICAS: Metrica[] = ['enviados', 'entregues', 'engajados', 'acoes'];

export function PainelClient({ inicial }: { inicial: DadosPainel }) {
  const [dados, setDados] = useState(inicial);
  const [dias, setDias] = useState(30);
  const [metrica, setMetrica] = useState<Metrica>('enviados');
  const [carregando, setCarregando] = useState(false);
  const [verTabela, setVerTabela] = useState(false);

  async function trocarPeriodo(novo: number) {
    setDias(novo);
    setCarregando(true);
    try {
      const res = await fetch(`/api/kpis?dias=${novo}`);
      if (res.ok) setDados((await res.json()) as DadosPainel);
    } catch {
      // Mantém os dados anteriores na tela: um painel que pisca vazio por causa de
      // uma falha de rede é pior do que um painel com o período anterior.
    } finally {
      setCarregando(false);
    }
  }

  const { whatsapp, email } = dados.resumo;
  const totalEnviado = whatsapp.enviados + email.enviados;

  return (
    <div className="max-w-6xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Painel</h1>
          <p className="mt-1.5 text-sm text-muted">
            O que saiu, o que chegou e o que as pessoas fizeram — nos dois canais.
          </p>
        </div>
        {/* Filtros numa linha só, acima dos gráficos. */}
        <div className="flex gap-1.5 rounded-xl border border-border bg-surface p-1">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              onClick={() => void trocarPeriodo(p.dias)}
              aria-pressed={dias === p.dias}
              className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors ${
                dias === p.dias ? 'bg-blue text-on-blue' : 'text-muted hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <Alertas dados={dados} />

      {totalEnviado === 0 ? (
        <VazioInicial />
      ) : (
        <>
          <section className="mb-7">
            <h2 className="mb-3.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Resumo dos últimos {dias} dias
            </h2>
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              <Tile
                label="Mensagens enviadas"
                valor={formatarNumero(totalEnviado)}
                apoio={`${formatarNumero(whatsapp.enviados)} no WhatsApp · ${formatarNumero(email.enviados)} por e-mail`}
                destaque
              />
              <Tile
                label="Leram no WhatsApp"
                valor={formatarTaxa(whatsapp.taxa_engajamento)}
                apoio={`${formatarNumero(whatsapp.engajados)} de ${formatarNumero(whatsapp.entregues)} entregues`}
                veredicto={avaliar(whatsapp.taxa_engajamento, REFERENCIAS.whatsapp_leitura)}
              />
              <Tile
                label="Abriram o e-mail"
                valor={formatarTaxa(email.taxa_engajamento)}
                apoio={`${formatarNumero(email.engajados)} de ${formatarNumero(email.entregues)} entregues`}
                veredicto={avaliar(email.taxa_engajamento, REFERENCIAS.email_abertura)}
              />
              <Tile
                label="Agiram"
                valor={formatarNumero(whatsapp.acoes + email.acoes)}
                apoio="respostas no WhatsApp + cliques no e-mail — o sinal mais forte que existe"
              />
            </div>
          </section>

          <section className="mb-7 rounded-xl2 border border-border bg-surface p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold">
                {ROTULO_METRICA[metrica].titulo} por dia
                {carregando && <span className="ml-2 text-xs font-normal text-muted">atualizando…</span>}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {METRICAS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetrica(m)}
                    aria-pressed={metrica === m}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      metrica === m
                        ? 'border-blue bg-blue/15 text-ink'
                        : 'border-border text-muted hover:text-ink'
                    }`}
                  >
                    {ROTULO_METRICA[m].titulo}
                  </button>
                ))}
              </div>
            </div>

            <SerieDiaria serie={dados.serie} metrica={metrica} />

            <p className="mt-3 text-xs leading-relaxed text-muted">
              No WhatsApp, <b className="text-ink">{ROTULO_METRICA[metrica].whatsapp}</b>. No e-mail,{' '}
              <b className="text-ink">{ROTULO_METRICA[metrica].email}</b>. Os dois canais usam a mesma
              escala — é a única forma de comparar as linhas sem se enganar.
            </p>

            <button
              type="button"
              onClick={() => setVerTabela((v) => !v)}
              className="mt-3 text-xs font-semibold text-blue2 hover:underline"
            >
              {verTabela ? 'Esconder os números' : 'Ver os números em tabela'}
            </button>
            {verTabela && <TabelaSerie dados={dados} metrica={metrica} />}
          </section>

          <section className="mb-7 grid gap-3.5 lg:grid-cols-2">
            <div className="rounded-xl2 border border-border bg-surface p-5">
              <Funil
                titulo="Funil do WhatsApp"
                etapas={[
                  {
                    rotulo: 'Enviadas',
                    valor: whatsapp.enviados,
                    explicacao: 'Saíram do sistema para o WhatsApp.',
                  },
                  {
                    rotulo: 'Entregues',
                    valor: whatsapp.entregues,
                    explicacao: 'Chegaram no aparelho — o ✓✓ cinza.',
                  },
                  {
                    rotulo: 'Lidas',
                    valor: whatsapp.engajados,
                    explicacao: 'A pessoa abriu a conversa — o ✓✓ azul.',
                  },
                  {
                    rotulo: 'Responderam',
                    valor: whatsapp.acoes,
                    explicacao: 'Escreveram de volta em até 7 dias.',
                  },
                ]}
              />
              <Conselho
                metrica="whatsapp_leitura"
                valor={whatsapp.taxa_engajamento}
                referencia={REFERENCIAS.whatsapp_leitura}
              />
            </div>

            <div className="rounded-xl2 border border-border bg-surface p-5">
              <Funil
                titulo="Funil do e-mail"
                etapas={[
                  { rotulo: 'Enviados', valor: email.enviados, explicacao: 'Entregues ao provedor de envio.' },
                  {
                    rotulo: 'Entregues',
                    valor: email.entregues,
                    explicacao: 'O servidor do destinatário aceitou (não voltou).',
                  },
                  {
                    rotulo: 'Abertos',
                    valor: email.engajados,
                    explicacao: 'Carregaram as imagens do e-mail. Tende a subestimar.',
                  },
                  {
                    rotulo: 'Clicaram',
                    valor: email.acoes,
                    explicacao: 'Clicaram em algum link. O sinal mais confiável dos quatro.',
                  },
                ]}
              />
              <Conselho
                metrica="email_abertura"
                valor={email.taxa_engajamento}
                referencia={REFERENCIAS.email_abertura}
              />
            </div>
          </section>

          <section className="mb-7 grid gap-3.5 lg:grid-cols-2">
            <UltimasCampanhas dados={dados} />
            <UltimosEmails dados={dados} />
          </section>

          <GruposQueLeem dados={dados} />
        </>
      )}
    </div>
  );
}

function Conselho({
  metrica,
  valor,
  referencia,
}: {
  metrica: keyof typeof REFERENCIAS;
  valor: number | null;
  referencia: { ruim: number; ok: number; bom: number; menorEhMelhor?: boolean };
}) {
  const texto = conselho(metrica, avaliar(valor, referencia));
  if (!texto) return null;
  return (
    <p className="mt-4 rounded-xl border border-border bg-surface2 px-3.5 py-3 text-xs leading-relaxed text-muted">
      <b className="text-ink">O que fazer:</b> {texto}
    </p>
  );
}

/** Avisos operacionais. Vêm antes dos números: um motor parado torna todo KPI mentira. */
function Alertas({ dados }: { dados: DadosPainel }) {
  const semConexao = dados.conexoes.length === 0;
  const conectadas = dados.conexoes.filter((c) => c.status === 'conectada').length;
  const comErro = dados.conexoes.filter((c) => c.status === 'erro');
  const fila = dados.fila.whatsapp + dados.fila.email;

  const alertas: { texto: React.ReactNode; grave: boolean }[] = [];
  if (semConexao) {
    alertas.push({
      grave: true,
      texto: (
        <>
          Nenhum número de WhatsApp conectado.{' '}
          <Link href="/conexoes" className="font-semibold underline">
            Conectar agora
          </Link>
        </>
      ),
    });
  } else if (conectadas === 0) {
    alertas.push({
      grave: true,
      texto: (
        <>
          Todos os números estão desconectados — nada sai até reconectar.{' '}
          <Link href="/conexoes" className="font-semibold underline">
            Ver conexões
          </Link>
        </>
      ),
    });
  }
  for (const c of comErro) {
    alertas.push({ grave: true, texto: <>Conexão “{c.nome}” com erro: {c.ultimo_erro ?? 'motivo não informado'}</> });
  }
  if (fila > 0) {
    alertas.push({
      grave: false,
      texto: (
        <>
          {formatarNumero(fila)} mensagem(ns) na fila esperando o motor — normal durante um disparo,
          já que o envio é espaçado para o número não ser bloqueado.
        </>
      ),
    });
  }

  if (!alertas.length) return null;
  return (
    <div className="mb-6 flex flex-col gap-2">
      {alertas.map((a, i) => (
        <div
          key={i}
          role={a.grave ? 'alert' : undefined}
          className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
            a.grave
              ? 'border-orange/30 bg-orange/[0.08] text-[#ffb183]'
              : 'border-border bg-surface text-muted'
          }`}
        >
          <span aria-hidden="true">{a.grave ? '⚠️' : 'ℹ️'}</span>
          <span>{a.texto}</span>
        </div>
      ))}
    </div>
  );
}

function VazioInicial() {
  return (
    <div className="rounded-xl2 border border-border bg-surface p-8">
      <h2 className="font-display text-lg font-semibold">Nada enviado ainda</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        Assim que a primeira campanha sair, este painel mostra quantas mensagens foram entregues,
        quantas foram lidas, quem respondeu e quais links foram clicados. Para começar:
      </p>
      <ol className="mt-4 ml-4 list-decimal space-y-2 text-sm text-muted">
        <li>
          <Link href="/conexoes" className="font-semibold text-blue2 hover:underline">
            Conecte um número de WhatsApp
          </Link>{' '}
          por QR Code e puxe os grupos.
        </li>
        <li>
          <Link href="/campanhas/nova" className="font-semibold text-blue2 hover:underline">
            Crie a primeira campanha
          </Link>{' '}
          — ou importe seus contatos em{' '}
          <Link href="/contatos" className="font-semibold text-blue2 hover:underline">
            Contatos
          </Link>{' '}
          e dispare um e-mail.
        </li>
      </ol>
    </div>
  );
}

function TabelaSerie({ dados, metrica }: { dados: DadosPainel; metrica: Metrica }) {
  const porDia = new Map<string, { whatsapp: number; email: number }>();
  for (const l of dados.serie) {
    const atual = porDia.get(l.dia) ?? { whatsapp: 0, email: 0 };
    atual[l.canal] = Number(l[metrica] ?? 0);
    porDia.set(l.dia, atual);
  }
  const linhas = [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface2 text-xs uppercase tracking-[0.06em] text-muted">
          <tr>
            <th className="px-3.5 py-2 text-left font-semibold">Dia</th>
            <th className="px-3.5 py-2 text-right font-semibold">WhatsApp</th>
            <th className="px-3.5 py-2 text-right font-semibold">E-mail</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(([dia, v]) => (
            <tr key={dia} className="border-t border-border">
              <td className="px-3.5 py-2">{dia.split('-').reverse().join('/')}</td>
              <td className="px-3.5 py-2 text-right tabular-nums">{formatarNumero(v.whatsapp)}</td>
              <td className="px-3.5 py-2 text-right tabular-nums">{formatarNumero(v.email)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UltimasCampanhas({ dados }: { dados: DadosPainel }) {
  return (
    <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
        Últimas campanhas de WhatsApp
      </h2>
      {dados.campanhas.length === 0 ? (
        <p className="p-5 text-sm text-muted">Nenhuma campanha enviada ainda.</p>
      ) : (
        <div className="divide-y divide-border">
          {dados.campanhas.slice(0, 6).map((c) => (
            <Link
              key={c.campaign_id}
              href={`/campanhas/${c.campaign_id}`}
              className="block px-5 py-3.5 transition-colors hover:bg-white/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{c.nome}</span>
                <span className="shrink-0 text-xs text-muted">{formatWhen(c.ultimo_envio_em)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                <span>{formatarNumero(c.enviados)} enviadas</span>
                <span>{formatarTaxa(c.taxa_entrega)} entregues</span>
                <span>
                  <b className="text-ink">{formatarTaxa(c.taxa_leitura)}</b> lidas
                </span>
                {c.respostas > 0 && <span>{formatarNumero(c.respostas)} responderam</span>}
                {c.falhas > 0 && <span className="text-[#ffb183]">{formatarNumero(c.falhas)} falharam</span>}
                {c.seg_ate_leitura_mediana !== null && (
                  <span>lida em {formatarDuracao(c.seg_ate_leitura_mediana)}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UltimosEmails({ dados }: { dados: DadosPainel }) {
  return (
    <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
        Últimas campanhas de e-mail
      </h2>
      {dados.emails.length === 0 ? (
        <p className="p-5 text-sm text-muted">
          Nenhum e-mail enviado ainda.{' '}
          <Link href="/email/nova" className="font-semibold text-blue2 hover:underline">
            Criar o primeiro
          </Link>
        </p>
      ) : (
        <div className="divide-y divide-border">
          {dados.emails.slice(0, 6).map((e) => (
            <Link
              key={e.campaign_id}
              href={`/email/${e.campaign_id}`}
              className="block px-5 py-3.5 transition-colors hover:bg-white/[0.03]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{e.nome}</span>
                <span className="shrink-0 text-xs text-muted">{formatWhen(e.enviado_em)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                <span>{formatarNumero(e.enviados)} enviados</span>
                <span>
                  <b className="text-ink">{formatarTaxa(e.taxa_abertura)}</b> abriram
                </span>
                <span>{formatarTaxa(e.taxa_clique)} clicaram</span>
                {e.bounces > 0 && <span className="text-[#ffb183]">{formatarNumero(e.bounces)} bounces</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * O ranking que economiza dinheiro: grupo que recebe muito e lê pouco é disparo
 * jogado fora — e, pior, é risco de bloqueio do número por mensagem ignorada.
 */
function GruposQueLeem({ dados }: { dados: DadosPainel }) {
  const comLeitura = dados.destinos.filter((d) => d.taxa_leitura !== null);
  if (comLeitura.length < 3) return null;

  const ordenados = [...comLeitura].sort((a, b) => (b.taxa_leitura ?? 0) - (a.taxa_leitura ?? 0));
  const melhores = ordenados.slice(0, 5);
  const piores = ordenados.slice(-5).reverse();

  return (
    <section className="grid gap-3.5 lg:grid-cols-2">
      <ListaDestinos titulo="Grupos que mais leem" destinos={melhores} bom />
      <ListaDestinos
        titulo="Grupos que menos leem"
        destinos={piores}
        rodape="Disparo para grupo que não lê é custo sem retorno — e mensagem ignorada em volume aumenta o risco de bloqueio do número. Vale desativar em Grupos."
      />
    </section>
  );
}

function ListaDestinos({
  titulo,
  destinos,
  bom,
  rodape,
}: {
  titulo: string;
  destinos: DadosPainel['destinos'];
  bom?: boolean;
  rodape?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">{titulo}</h2>
      <div className="divide-y divide-border">
        {destinos.map((d) => (
          <div key={d.destino} className="flex items-center gap-3 px-5 py-3">
            <span className="min-w-0 flex-1 truncate text-sm">{d.destino_nome ?? d.destino}</span>
            <span className="shrink-0 text-xs text-muted">{formatarNumero(d.recebidas)} recebidas</span>
            <span
              className={`shrink-0 text-sm font-semibold tabular-nums ${bom ? 'text-[#D7F264]' : 'text-[#ffb183]'}`}
            >
              {formatarTaxa(d.taxa_leitura)}
            </span>
          </div>
        ))}
      </div>
      {rodape && <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">{rodape}</p>}
    </div>
  );
}
