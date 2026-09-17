import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import type { Campaign, CampaignKpi, CampaignRecipient, RecipientStatus } from '@/lib/types';
import { Funil } from '@/components/charts/Funil';
import { Tile } from '@/components/charts/Tile';
import { avaliar, conselho, formatarDuracao, formatarNumero, formatarTaxa, REFERENCIAS } from '@/lib/kpis';
import { formatWhen } from '@/lib/format';
import { StatusChip } from '@/components/StatusChip';

export const dynamic = 'force-dynamic';

const ROTULO_DESTINATARIO: Record<RecipientStatus, { label: string; cls: string }> = {
  pendente: { label: 'na fila', cls: 'text-muted' },
  enviando: { label: 'enviando', cls: 'text-[#ffb183]' },
  enviado: { label: 'enviada', cls: 'text-[#DFEFC5]' },
  entregue: { label: 'entregue', cls: 'text-[#DFEFC5]' },
  lido: { label: 'lida', cls: 'text-[#D7F264]' },
  falha: { label: 'falhou', cls: 'text-[#ffb183]' },
  cancelado: { label: 'cancelada', cls: 'text-muted' },
};

export default async function ResultadoCampanhaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: bruta } = await supabase.from('campaigns').select('*').eq('id', id).maybeSingle();
  if (!bruta) {
    return (
      <div className="rounded-xl2 border border-border bg-surface p-6 text-sm text-muted">
        Campanha não encontrada.{' '}
        <Link href="/campanhas" className="font-semibold text-blue2 hover:underline">
          Voltar para a lista
        </Link>
      </div>
    );
  }
  const campanha = bruta as Campaign;

  const [{ data: kpiBruto }, { data: destinatarios }] = await Promise.all([
    supabase.from('vw_campaign_kpis').select('*').eq('campaign_id', id).maybeSingle(),
    supabase
      .from('campaign_recipients')
      .select('*')
      .eq('campaign_id', id)
      .order('enviado_em', { ascending: true, nullsFirst: false })
      .limit(1000),
  ]);

  const kpi = kpiBruto as CampaignKpi | null;
  const linhas = (destinatarios ?? []) as CampaignRecipient[];
  const falhas = linhas.filter((l) => l.status === 'falha');

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <Link href="/campanhas" className="mb-2 inline-block text-xs font-semibold text-muted hover:text-ink">
          ← Campanhas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">
              {campanha.nome}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2.5 text-sm text-muted">
              <StatusChip status={campanha.status} />
              <span>{formatWhen(campanha.enviado_em ?? campanha.enviar_em)}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="mb-6 rounded-xl2 border border-border bg-surface p-5">
        <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
          A mensagem enviada
        </h2>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{campanha.mensagem}</p>
        {campanha.midia_url && (
          <p className="mt-2.5 truncate text-xs text-muted">
            Com mídia ({campanha.tipo}): <span className="font-mono">{campanha.midia_url}</span>
          </p>
        )}
      </section>

      {!kpi || kpi.destinatarios === 0 ? (
        <div className="rounded-xl2 border border-border bg-surface p-6 text-sm leading-relaxed text-muted">
          {campanha.status === 'agendada' ? (
            <>
              Esta campanha ainda não saiu. A fila de destinatários é montada no horário agendado — é
              a partir daí que os números aparecem aqui.
            </>
          ) : campanha.status === 'erro' && campanha.resultado?.erro ? (
            <span className="text-[#ffb183]">{campanha.resultado.erro}</span>
          ) : (
            <>Nenhum destinatário registrado para esta campanha.</>
          )}
        </div>
      ) : (
        <>
          <section className="mb-7 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <Tile
              label="Destinatários"
              valor={formatarNumero(kpi.destinatarios)}
              apoio={
                kpi.pendentes > 0
                  ? `${formatarNumero(kpi.pendentes)} ainda na fila — o envio é espaçado de propósito`
                  : 'fila concluída'
              }
              destaque
            />
            <Tile
              label="Entregues"
              valor={formatarTaxa(kpi.taxa_entrega)}
              apoio={`${formatarNumero(kpi.entregues)} chegaram no aparelho`}
              veredicto={avaliar(kpi.taxa_entrega, REFERENCIAS.whatsapp_entrega)}
            />
            <Tile
              label="Lidas"
              valor={formatarTaxa(kpi.taxa_leitura)}
              apoio={`${formatarNumero(kpi.lidos)} abriram a conversa`}
              veredicto={avaliar(kpi.taxa_leitura, REFERENCIAS.whatsapp_leitura)}
            />
            <Tile
              label="Responderam"
              valor={formatarNumero(kpi.respostas)}
              apoio="escreveram de volta em até 7 dias — o sinal mais forte"
              veredicto={avaliar(kpi.taxa_resposta, REFERENCIAS.whatsapp_resposta)}
            />
          </section>

          <section className="mb-7 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="rounded-xl2 border border-border bg-surface p-5">
              <Funil
                titulo="O caminho da mensagem"
                etapas={[
                  { rotulo: 'Enviadas', valor: kpi.enviados, explicacao: 'Saíram para o WhatsApp.' },
                  { rotulo: 'Entregues', valor: kpi.entregues, explicacao: 'Chegaram no aparelho — o ✓✓ cinza.' },
                  { rotulo: 'Lidas', valor: kpi.lidos, explicacao: 'A conversa foi aberta — o ✓✓ azul.' },
                  { rotulo: 'Responderam', valor: kpi.respostas, explicacao: 'Escreveram de volta.' },
                ]}
              />
              <Conselhos kpi={kpi} />
            </div>

            <div className="flex flex-col gap-3.5">
              {kpi.seg_ate_entrega_mediana !== null && (
                <Tile
                  label="Tempo até entregar"
                  valor={formatarDuracao(kpi.seg_ate_entrega_mediana)}
                  apoio="mediana entre sair daqui e chegar no aparelho"
                />
              )}
              {kpi.seg_ate_leitura_mediana !== null && (
                <Tile
                  label="Tempo até ler"
                  valor={formatarDuracao(kpi.seg_ate_leitura_mediana)}
                  apoio="mediana entre entregar e a pessoa abrir — útil para escolher o horário"
                />
              )}
              {kpi.falhas > 0 && (
                <Tile
                  label="Falharam"
                  valor={formatarNumero(kpi.falhas)}
                  apoio={`${formatarTaxa(kpi.taxa_falha)} dos destinatários`}
                />
              )}
            </div>
          </section>

          {falhas.length > 0 && (
            <section className="mb-7 overflow-hidden rounded-xl2 border border-orange/25 bg-surface">
              <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold text-[#ffb183]">
                Quem não recebeu ({formatarNumero(falhas.length)})
              </h2>
              <div className="max-h-80 divide-y divide-border overflow-auto">
                {falhas.map((f) => (
                  <div key={f.id} className="px-5 py-2.5">
                    <div className="text-sm">{f.destino_nome || f.destino}</div>
                    {f.erro && <div className="mt-0.5 text-xs leading-relaxed text-muted">{f.erro}</div>}
                  </div>
                ))}
              </div>
              <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
                Antes, uma falha era só um número no contador. Agora dá para ver exatamente qual
                grupo ficou de fora e por quê — e resolver em vez de adivinhar.
              </p>
            </section>
          )}

          <section className="overflow-hidden rounded-xl2 border border-border bg-surface">
            <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
              Destinatário por destinatário
            </h2>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface2 text-xs uppercase tracking-[0.06em] text-muted">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-semibold">Destino</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Situação</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Enviada</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Entregue</th>
                    <th className="px-5 py-2.5 text-left font-semibold">Lida</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="max-w-[240px] truncate px-5 py-2.5">
                        {l.destino_nome || l.destino}
                      </td>
                      <td className={`px-3 py-2.5 ${ROTULO_DESTINATARIO[l.status].cls}`}>
                        {ROTULO_DESTINATARIO[l.status].label}
                        {l.respondido_em && <span className="ml-1.5 text-[#D7F264]">· respondeu</span>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted">{formatWhen(l.enviado_em)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted">{formatWhen(l.entregue_em)}</td>
                      <td className="px-5 py-2.5 tabular-nums text-muted">{formatWhen(l.lido_em)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {linhas.length >= 1000 && (
              <p className="border-t border-border px-5 py-3 text-xs text-muted">
                Mostrando os 1.000 primeiros destinatários.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Conselhos({ kpi }: { kpi: CampaignKpi }) {
  const dicas = [
    conselho('whatsapp_entrega', avaliar(kpi.taxa_entrega, REFERENCIAS.whatsapp_entrega)),
    conselho('whatsapp_leitura', avaliar(kpi.taxa_leitura, REFERENCIAS.whatsapp_leitura)),
  ].filter(Boolean) as string[];

  if (!dicas.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface2 px-3.5 py-3">
      <span className="mb-1.5 block text-xs font-semibold text-ink">O que fazer</span>
      <ul className="flex flex-col gap-2 text-xs leading-relaxed text-muted">
        {dicas.map((d) => (
          <li key={d}>→ {d}</li>
        ))}
      </ul>
    </div>
  );
}
