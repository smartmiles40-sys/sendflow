import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import type { EmailAbKpi, EmailCampaign, EmailKpi, EmailLinkKpi, EmailRecipient } from '@/lib/types';
import { Funil } from '@/components/charts/Funil';
import { Tile } from '@/components/charts/Tile';
import { avaliar, conselho, formatarDuracao, formatarNumero, formatarTaxa, REFERENCIAS } from '@/lib/kpis';
import { formatWhen } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ResultadoEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: bruta } = await supabase.from('email_campaigns').select('*').eq('id', id).maybeSingle();
  if (!bruta) {
    return (
      <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
        Campanha não encontrada.{' '}
        <Link href="/email" className="font-semibold text-blue2 hover:underline">
          Voltar para a lista
        </Link>
      </div>
    );
  }
  const campanha = bruta as EmailCampaign;

  const [{ data: kpiBruto }, { data: links }, { data: ab }, { data: destinatarios }] = await Promise.all([
    supabase.from('vw_email_kpis').select('*').eq('campaign_id', id).maybeSingle(),
    supabase
      .from('vw_email_links')
      .select('*')
      .eq('campaign_id', id)
      .order('cliques', { ascending: false })
      .limit(10),
    campanha.assunto_b
      ? supabase.from('vw_email_ab').select('*').eq('campaign_id', id)
      : Promise.resolve({ data: [] as EmailAbKpi[] }),
    // Quem mais se envolveu primeiro: é a lista que o comercial quer ver.
    supabase
      .from('email_recipients')
      .select('*')
      .eq('campaign_id', id)
      .order('cliques', { ascending: false })
      .order('aberturas', { ascending: false })
      .limit(200),
  ]);

  const kpi = kpiBruto as EmailKpi | null;
  const editavel = ['rascunho', 'agendada', 'cancelada'].includes(campanha.status);

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <Link href="/email" className="mb-2 inline-block text-xs font-semibold text-muted hover:text-ink">
          ← Campanhas de e-mail
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">{campanha.nome}</h1>
            <p className="mt-1.5 text-sm text-muted">
              <b className="text-ink">{campanha.assunto}</b>
              {campanha.enviado_em && <> · enviada em {formatWhen(campanha.enviado_em)}</>}
            </p>
          </div>
          {editavel && (
            <Link
              href={`/email/${id}/editar`}
              className="shrink-0 rounded-xl border border-border px-4 py-2.5 text-[13px] font-semibold text-muted transition-colors hover:border-blue2 hover:text-ink"
            >
              Editar campanha
            </Link>
          )}
        </div>
      </header>

      {!kpi || kpi.destinatarios === 0 ? (
        <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
          Esta campanha ainda não foi enviada. Os números aparecem aqui assim que o envio começar.
        </div>
      ) : (
        <>
          <section className="mb-7 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <Tile
              label="Enviados"
              valor={formatarNumero(kpi.enviados)}
              apoio={kpi.pendentes > 0 ? `${formatarNumero(kpi.pendentes)} ainda na fila` : 'fila concluída'}
              destaque
            />
            <Tile
              label="Abriram"
              valor={formatarTaxa(kpi.taxa_abertura)}
              apoio={`${formatarNumero(kpi.abriram)} pessoas · ${formatarNumero(kpi.aberturas_totais)} aberturas no total`}
              veredicto={avaliar(kpi.taxa_abertura, REFERENCIAS.email_abertura)}
            />
            <Tile
              label="Clicaram"
              valor={formatarTaxa(kpi.taxa_clique)}
              apoio={`${formatarNumero(kpi.clicaram)} pessoas · ${formatarNumero(kpi.cliques_totais)} cliques`}
              veredicto={avaliar(kpi.taxa_clique, REFERENCIAS.email_clique)}
            />
            <Tile
              label="Clicaram entre os que abriram"
              valor={formatarTaxa(kpi.ctor)}
              apoio="o CTOR separa assunto fraco de conteúdo fraco"
              veredicto={avaliar(kpi.ctor, REFERENCIAS.email_ctor)}
            />
          </section>

          <section className="mb-7 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-xl2 border border-border bg-surface p-5">
              <Funil
                titulo="O caminho do e-mail"
                etapas={[
                  { rotulo: 'Enviados', valor: kpi.enviados, explicacao: 'Entregues ao provedor de envio.' },
                  {
                    rotulo: 'Entregues',
                    valor: kpi.entregues,
                    explicacao: 'O servidor do destinatário aceitou.',
                  },
                  {
                    rotulo: 'Abertos',
                    valor: kpi.abriram,
                    explicacao:
                      'Carregaram as imagens. Quem lê com imagens bloqueadas não é contado — o número real é maior.',
                  },
                  {
                    rotulo: 'Clicaram',
                    valor: kpi.clicaram,
                    explicacao: 'Clicaram em algum link. O sinal mais confiável dos quatro.',
                  },
                ]}
              />
              {kpi.seg_ate_abertura_mediana !== null && (
                <p className="mt-4 text-xs leading-relaxed text-muted">
                  Metade de quem abriu fez isso em até{' '}
                  <b className="text-ink">{formatarDuracao(kpi.seg_ate_abertura_mediana)}</b> depois do
                  envio — útil para escolher o horário do próximo disparo.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3.5">
              <Tile
                label="Bounces"
                valor={formatarNumero(kpi.bounces)}
                apoio="caixas que recusaram. O contato é descadastrado automaticamente."
                veredicto={avaliar(kpi.taxa_bounce, REFERENCIAS.email_bounce)}
              />
              <Tile
                label="Marcaram como spam"
                valor={formatarNumero(kpi.spam)}
                apoio="o pior sinal que existe: derruba a reputação do domínio inteiro."
                veredicto={avaliar(kpi.taxa_spam, REFERENCIAS.email_spam)}
              />
              {kpi.falhas > 0 && (
                <Tile
                  label="Falharam no envio"
                  valor={formatarNumero(kpi.falhas)}
                  apoio="erro técnico no envio, não recusa do destinatário."
                />
              )}
            </div>
          </section>

          <Recomendacao kpi={kpi} />

          {ab && ab.length > 1 && <TesteAB variantes={ab as EmailAbKpi[]} />}

          {links && links.length > 0 && <LinksMaisClicados links={links as EmailLinkKpi[]} />}

          <QuemEngajou destinatarios={(destinatarios ?? []) as EmailRecipient[]} />
        </>
      )}
    </div>
  );
}

/** A leitura do resultado em uma frase — para quem não vive de marketing. */
function Recomendacao({ kpi }: { kpi: EmailKpi }) {
  const dicas = [
    conselho('email_abertura', avaliar(kpi.taxa_abertura, REFERENCIAS.email_abertura)),
    conselho('email_ctor', avaliar(kpi.ctor, REFERENCIAS.email_ctor)),
    conselho('email_bounce', avaliar(kpi.taxa_bounce, REFERENCIAS.email_bounce)),
    conselho('email_spam', avaliar(kpi.taxa_spam, REFERENCIAS.email_spam)),
  ].filter(Boolean) as string[];

  if (!dicas.length) {
    return (
      <div className="mb-7 rounded-xl2 border border-[color:var(--color-bom)]/30 bg-[color:var(--color-bom)]/[0.07] p-5 text-sm leading-relaxed text-[#8ce68c]">
        <b>Campanha saudável.</b> Abertura, clique e bounce estão dentro ou acima das referências de
        mercado. Vale guardar este assunto e este formato como padrão.
      </div>
    );
  }

  return (
    <div className="mb-7 rounded-xl2 border border-border bg-surface p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        O que dá para melhorar
      </h2>
      <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-muted">
        {dicas.map((d) => (
          <li key={d} className="flex gap-2.5">
            <span aria-hidden="true">→</span>
            <span>{d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TesteAB({ variantes }: { variantes: EmailAbKpi[] }) {
  const ordenadas = [...variantes].sort((a, b) => (b.taxa_abertura ?? 0) - (a.taxa_abertura ?? 0));
  const vencedora = ordenadas[0];
  // Uma diferença mínima em amostra pequena é ruído, não aprendizado. O corte é
  // deliberadamente conservador: dizer "A ganhou" por 0,4 ponto ensina a coisa errada.
  const diferenca = (ordenadas[0].taxa_abertura ?? 0) - (ordenadas[1]?.taxa_abertura ?? 0);
  const conclusivo = diferenca >= 3 && ordenadas.every((v) => v.entregues >= 50);

  return (
    <section className="mb-7 overflow-hidden rounded-xl2 border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
        Teste A/B do assunto
      </h2>
      <div className="divide-y divide-border">
        {variantes.map((v) => (
          <div key={v.variante} className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm">
                <b className="mr-2 font-display">{v.variante}</b>
                {v.assunto}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatarTaxa(v.taxa_abertura)} de abertura
              </span>
            </div>
            <div className="mt-1 text-xs text-muted">
              {formatarNumero(v.entregues)} entregues · {formatarNumero(v.abriram)} abriram ·{' '}
              {formatarNumero(v.clicaram)} clicaram ({formatarTaxa(v.taxa_clique)})
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-border px-5 py-3.5 text-xs leading-relaxed text-muted">
        {conclusivo ? (
          <>
            <b className="text-ink">O assunto {vencedora.variante} ganhou</b> por{' '}
            {diferenca.toFixed(1).replace('.', ',')} pontos. Vale repetir esse estilo de assunto na
            próxima campanha.
          </>
        ) : (
          <>
            A diferença entre os dois assuntos é pequena demais para ser conclusiva — com esta
            quantidade de gente, isso é variação normal e não aprendizado. Para um resultado
            confiável, teste assuntos bem diferentes entre si numa lista maior.
          </>
        )}
      </p>
    </section>
  );
}

function LinksMaisClicados({ links }: { links: EmailLinkKpi[] }) {
  return (
    <section className="mb-7 overflow-hidden rounded-xl2 border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
        Links mais clicados
      </h2>
      <div className="divide-y divide-border">
        {links.map((l) => (
          <div key={l.url} className="flex items-center gap-4 px-5 py-3">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={l.url}>
              {l.url}
            </span>
            <span className="shrink-0 text-xs text-muted">{formatarNumero(l.pessoas)} pessoas</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {formatarNumero(l.cliques)}
            </span>
          </div>
        ))}
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-muted">
        Este é o dado que diz o que interessou de verdade — mais confiável que a taxa de abertura,
        porque não depende de o cliente de e-mail carregar imagens.
      </p>
    </section>
  );
}

function QuemEngajou({ destinatarios }: { destinatarios: EmailRecipient[] }) {
  const engajados = destinatarios.filter((d) => d.aberturas > 0 || d.cliques > 0);
  const problemas = destinatarios.filter((d) => ['bounce', 'spam', 'falha'].includes(d.status));

  return (
    <section className="grid gap-3.5 lg:grid-cols-2">
      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
          Quem mais se interessou
        </h2>
        {engajados.length === 0 ? (
          <p className="p-5 text-sm text-muted">Ninguém abriu ainda.</p>
        ) : (
          <div className="max-h-96 divide-y divide-border overflow-auto">
            {engajados.slice(0, 50).map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{d.nome || d.email}</span>
                <span className="shrink-0 text-xs text-muted">
                  {d.cliques > 0 && <b className="text-[#7effcf]">{d.cliques} clique(s) · </b>}
                  {d.aberturas} abertura(s)
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
          Quem clicou é a lista de quem falar primeiro. Vale exportar e mandar para o comercial.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl2 border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
          Endereços com problema
        </h2>
        {problemas.length === 0 ? (
          <p className="p-5 text-sm text-muted">Nenhum bounce nem reclamação. 👌</p>
        ) : (
          <div className="max-h-96 divide-y divide-border overflow-auto">
            {problemas.slice(0, 50).map((d) => (
              <div key={d.id} className="px-5 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{d.email}</span>
                  <span className="shrink-0 text-xs font-semibold text-[#ffb183]">{d.status}</span>
                </div>
                {d.erro && <p className="mt-0.5 truncate text-xs text-muted">{d.erro}</p>}
              </div>
            ))}
          </div>
        )}
        <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
          Bounce e spam já descadastraram o contato automaticamente — não é preciso fazer nada.
        </p>
      </div>
    </section>
  );
}
