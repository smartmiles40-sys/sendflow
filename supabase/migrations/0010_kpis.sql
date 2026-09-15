-- supabase/migrations/0010_kpis.sql
-- As visões de KPI. A conta mora no banco, não no front — assim o painel, uma export
-- para planilha e qualquer consulta futura leem o MESMO número, e ninguém recalcula
-- "taxa de abertura" de um jeito diferente em dois lugares.
--
-- Todas usam `security_invoker = true`: a visão respeita o RLS de quem consulta, em vez
-- de rodar com os poderes do dono. Como as tabelas têm RLS ligado e sem policy, só o
-- service_role (as rotas do app) enxerga os dados.
--
-- Convenção das taxas: percentual 0–100, arredondado em 1 casa, e NULL (não zero) quando
-- o denominador é zero. Zero por cento e "ainda não dá para dizer" são coisas diferentes.

-- ── WhatsApp: uma linha por campanha ─────────────────────────────────────────────
create or replace view public.vw_campaign_kpis
with (security_invoker = true) as
select
  c.id                                                            as campaign_id,
  c.nome,
  c.categoria,
  c.status,
  c.alvo,
  c.connection_id,
  c.enviar_em,
  c.enviado_em,
  count(r.id)                                                     as destinatarios,
  -- Cumulativo: quem foi LIDO também foi entregue e enviado. Se contássemos só o estado
  -- final, a "taxa de entrega" cairia toda vez que alguém lesse a mensagem.
  count(*) filter (where r.status in ('enviado','entregue','lido'))          as enviados,
  count(*) filter (where r.status in ('entregue','lido'))                    as entregues,
  count(*) filter (where r.status = 'lido')                                  as lidos,
  count(*) filter (where r.respondido_em is not null)                        as respostas,
  count(*) filter (where r.status = 'falha')                                 as falhas,
  count(*) filter (where r.status = 'pendente')                              as pendentes,

  round(100.0 * count(*) filter (where r.status in ('entregue','lido'))
        / nullif(count(*) filter (where r.status in ('enviado','entregue','lido')), 0), 1)
                                                                  as taxa_entrega,
  round(100.0 * count(*) filter (where r.status = 'lido')
        / nullif(count(*) filter (where r.status in ('entregue','lido')), 0), 1)
                                                                  as taxa_leitura,
  round(100.0 * count(*) filter (where r.respondido_em is not null)
        / nullif(count(*) filter (where r.status in ('enviado','entregue','lido')), 0), 1)
                                                                  as taxa_resposta,
  round(100.0 * count(*) filter (where r.status = 'falha')
        / nullif(count(r.id), 0), 1)                              as taxa_falha,

  -- Quanto tempo o WhatsApp levou para entregar, e a pessoa para abrir. Mediana em vez
  -- de média: um destinatário com o celular desligado por 8h não desloca a mediana.
  round(extract(epoch from percentile_cont(0.5) within group (
        order by r.entregue_em - r.enviado_em))::numeric, 0)      as seg_ate_entrega_mediana,
  round(extract(epoch from percentile_cont(0.5) within group (
        order by r.lido_em - r.entregue_em))::numeric, 0)         as seg_ate_leitura_mediana,
  min(r.enviado_em)                                               as primeiro_envio_em,
  max(r.enviado_em)                                               as ultimo_envio_em
from public.campaigns c
left join public.campaign_recipients r on r.campaign_id = c.id
group by c.id;

-- ── WhatsApp: uma linha por grupo/contato, somando todas as campanhas ────────────
-- Responde "qual grupo lê o que a gente manda?" — o insumo para parar de gastar
-- disparo em grupo morto.
create or replace view public.vw_destino_kpis
with (security_invoker = true) as
select
  r.destino,
  max(r.destino_nome)                                             as destino_nome,
  r.destino_tipo,
  count(*)                                                        as recebidas,
  count(*) filter (where r.status in ('entregue','lido'))          as entregues,
  count(*) filter (where r.status = 'lido')                        as lidas,
  count(*) filter (where r.respondido_em is not null)              as respostas,
  count(*) filter (where r.status = 'falha')                       as falhas,
  round(100.0 * count(*) filter (where r.status = 'lido')
        / nullif(count(*) filter (where r.status in ('entregue','lido')), 0), 1)
                                                                  as taxa_leitura,
  max(r.enviado_em)                                               as ultimo_envio_em
from public.campaign_recipients r
group by r.destino, r.destino_tipo;

-- ── E-mail: uma linha por campanha ───────────────────────────────────────────────
create or replace view public.vw_email_kpis
with (security_invoker = true) as
select
  e.id                                                            as campaign_id,
  e.nome,
  e.assunto,
  e.status,
  e.enviar_em,
  e.enviado_em,
  count(r.id)                                                     as destinatarios,
  count(*) filter (where r.status in ('enviado','entregue','aberto','clicado'))  as enviados,
  count(*) filter (where r.status in ('entregue','aberto','clicado'))            as entregues,
  -- Aberturas e cliques ÚNICOS (pessoas), não o total de eventos. É o padrão do mercado:
  -- "taxa de abertura" é gente que abriu, não vezes que abriu.
  count(*) filter (where r.primeiro_aberto_em is not null)        as abriram,
  count(*) filter (where r.primeiro_clique_em is not null)        as clicaram,
  coalesce(sum(r.aberturas), 0)                                   as aberturas_totais,
  coalesce(sum(r.cliques), 0)                                     as cliques_totais,
  count(*) filter (where r.status = 'bounce')                     as bounces,
  count(*) filter (where r.status = 'spam')                       as spam,
  count(*) filter (where r.status = 'falha')                      as falhas,
  count(*) filter (where r.status = 'pendente')                   as pendentes,

  round(100.0 * count(*) filter (where r.status in ('entregue','aberto','clicado'))
        / nullif(count(*) filter (where r.status in ('enviado','entregue','aberto','clicado')), 0), 1)
                                                                  as taxa_entrega,
  -- Abertura e clique sobre ENTREGUES: quem não recebeu não podia abrir.
  round(100.0 * count(*) filter (where r.primeiro_aberto_em is not null)
        / nullif(count(*) filter (where r.status in ('entregue','aberto','clicado')), 0), 1)
                                                                  as taxa_abertura,
  round(100.0 * count(*) filter (where r.primeiro_clique_em is not null)
        / nullif(count(*) filter (where r.status in ('entregue','aberto','clicado')), 0), 1)
                                                                  as taxa_clique,
  -- CTOR: clicou entre os que ABRIRAM. Separa "o assunto é ruim" (abertura baixa) de
  -- "o conteúdo é ruim" (abriu e não clicou) — o diagnóstico que a taxa de clique esconde.
  round(100.0 * count(*) filter (where r.primeiro_clique_em is not null)
        / nullif(count(*) filter (where r.primeiro_aberto_em is not null), 0), 1)
                                                                  as ctor,
  round(100.0 * count(*) filter (where r.status = 'bounce')
        / nullif(count(*) filter (where r.status <> 'pendente'), 0), 1)
                                                                  as taxa_bounce,
  round(100.0 * count(*) filter (where r.status = 'spam')
        / nullif(count(*) filter (where r.status in ('entregue','aberto','clicado')), 0), 1)
                                                                  as taxa_spam,
  round(extract(epoch from percentile_cont(0.5) within group (
        order by r.primeiro_aberto_em - r.enviado_em))::numeric, 0)
                                                                  as seg_ate_abertura_mediana
from public.email_campaigns e
left join public.email_recipients r on r.campaign_id = e.id
group by e.id;

-- ── E-mail: teste A/B do assunto ─────────────────────────────────────────────────
-- Uma linha por variante. O painel só mostra quando a campanha tem `assunto_b`.
create or replace view public.vw_email_ab
with (security_invoker = true) as
select
  r.campaign_id,
  r.variante,
  case when r.variante = 'B' then e.assunto_b else e.assunto end  as assunto,
  count(*)                                                        as destinatarios,
  count(*) filter (where r.status in ('entregue','aberto','clicado'))  as entregues,
  count(*) filter (where r.primeiro_aberto_em is not null)        as abriram,
  count(*) filter (where r.primeiro_clique_em is not null)        as clicaram,
  round(100.0 * count(*) filter (where r.primeiro_aberto_em is not null)
        / nullif(count(*) filter (where r.status in ('entregue','aberto','clicado')), 0), 1)
                                                                  as taxa_abertura,
  round(100.0 * count(*) filter (where r.primeiro_clique_em is not null)
        / nullif(count(*) filter (where r.status in ('entregue','aberto','clicado')), 0), 1)
                                                                  as taxa_clique
from public.email_recipients r
join public.email_campaigns e on e.id = r.campaign_id
group by r.campaign_id, r.variante, e.assunto, e.assunto_b;

-- ── E-mail: ranking de links ─────────────────────────────────────────────────────
-- "O que exatamente chamou a atenção" — o link mais clicado de cada campanha.
create or replace view public.vw_email_links
with (security_invoker = true) as
select
  ev.campaign_id,
  ev.url,
  count(*)                                                        as cliques,
  count(distinct ev.recipient_id)                                 as pessoas,
  min(ev.criado_em)                                               as primeiro_clique_em
from public.email_events ev
where ev.tipo = 'clicado' and ev.url is not null
group by ev.campaign_id, ev.url;

-- ── Contatos: engajamento consolidado ────────────────────────────────────────────
-- Cruza os dois canais por pessoa. É a visão que responde "quem está quente agora".
create or replace view public.vw_contato_engajamento
with (security_invoker = true) as
select
  ct.id                                                           as contact_id,
  ct.nome,
  ct.email,
  ct.telefone,
  ct.tags,
  ct.status_email,
  ct.status_whatsapp,
  coalesce(em.recebidos, 0)                                       as emails_recebidos,
  coalesce(em.abertos, 0)                                         as emails_abertos,
  coalesce(em.clicados, 0)                                        as emails_clicados,
  coalesce(wa.recebidas, 0)                                       as whatsapp_recebidas,
  coalesce(wa.lidas, 0)                                           as whatsapp_lidas,
  -- GREATEST ignora NULL, então basta descartar o piso quando os dois lados são nulos.
  nullif(
    greatest(
      coalesce(em.ultima_interacao, 'epoch'::timestamptz),
      coalesce(wa.ultima_interacao, 'epoch'::timestamptz)
    ),
    'epoch'::timestamptz
  )                                                               as ultima_interacao,
  -- Nota 0–100 de engajamento. Pesos deliberados: clicar no e-mail (4) e responder no
  -- WhatsApp (5) são ATOS; abrir (2) e ler (2) são sinais mais fracos. A nota satura em
  -- 100 de propósito — serve para ordenar quem falar primeiro, não para ranking fino.
  least(100, (
    coalesce(em.abertos, 0) * 2 +
    coalesce(em.clicados, 0) * 4 +
    coalesce(wa.lidas, 0) * 2 +
    coalesce(wa.respostas, 0) * 5
  ))                                                              as nota_engajamento
from public.contacts ct
left join (
  select contact_id,
         count(*) filter (where status in ('enviado','entregue','aberto','clicado')) as recebidos,
         count(*) filter (where primeiro_aberto_em is not null)                      as abertos,
         count(*) filter (where primeiro_clique_em is not null)                      as clicados,
         max(greatest(ultimo_aberto_em, primeiro_clique_em))                         as ultima_interacao
  from public.email_recipients
  where contact_id is not null
  group by contact_id
) em on em.contact_id = ct.id
left join (
  select contact_id,
         count(*)                                                as recebidas,
         count(*) filter (where status = 'lido')                  as lidas,
         count(*) filter (where respondido_em is not null)        as respostas,
         max(greatest(lido_em, respondido_em))                    as ultima_interacao
  from public.campaign_recipients
  where contact_id is not null
  group by contact_id
) wa on wa.contact_id = ct.id;

-- ── Série diária dos dois canais ─────────────────────────────────────────────────
-- Para o gráfico do painel. A data é o DIA EM SÃO PAULO: `timestamptz at time zone`
-- devolve o relógio local, e só então cai para `date`. Truncar em UTC jogaria tudo que
-- saiu depois das 21h para o dia seguinte.
create or replace view public.vw_kpis_diarios
with (security_invoker = true) as
select
  (enviado_em at time zone 'America/Sao_Paulo')::date             as dia,
  'whatsapp'                                                      as canal,
  count(*)                                                        as enviados,
  count(*) filter (where status in ('entregue','lido'))            as entregues,
  count(*) filter (where status = 'lido')                          as engajados,
  count(*) filter (where respondido_em is not null)                as acoes,
  count(*) filter (where status = 'falha')                         as falhas
from public.campaign_recipients
where enviado_em is not null
group by 1
union all
select
  (enviado_em at time zone 'America/Sao_Paulo')::date             as dia,
  'email'                                                         as canal,
  count(*)                                                        as enviados,
  count(*) filter (where status in ('entregue','aberto','clicado')) as entregues,
  count(*) filter (where primeiro_aberto_em is not null)           as engajados,
  count(*) filter (where primeiro_clique_em is not null)           as acoes,
  count(*) filter (where status in ('falha','bounce'))             as falhas
from public.email_recipients
where enviado_em is not null
group by 1;
