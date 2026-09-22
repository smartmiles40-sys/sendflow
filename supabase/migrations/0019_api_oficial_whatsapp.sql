-- supabase/migrations/0019_api_oficial_whatsapp.sql
-- A API oficial da Meta (WhatsApp Cloud API) como segundo conector, e a REGRA que
-- decide qual conector cada campanha pode usar.
--
-- Por que existir um segundo conector em vez de escalar o que já havia:
--
--   • A Evolution (chip lido por QR Code) é a ÚNICA que envia para GRUPO. A Meta não
--     expõe grupos na Cloud API, e não há sinal de que vá expor.
--   • A Evolution NÃO aguenta disparo em massa 1-a-1. O ritmo anti-bloqueio de 8–15 s
--     por mensagem dá ~500/dia por número, e passar disso é exatamente o padrão que a
--     Meta classifica como "spam, automated, or bulk messaging" — o bloqueio de 24 h
--     que já derrubou os chips do time.
--   • A Cloud API faz 1-a-1 em massa sem risco de banimento, com template aprovado,
--     ACK por destinatário de verdade e opt-out que a própria Meta respeita.
--
-- Daí a regra gravada aqui embaixo, em trigger, e não só na tela: campanha para
-- CONTATOS (disparo em massa) só sai por conexão `cloud`. Grupo continua na Evolution.
-- A tela valida antes com mensagem legível; o trigger é a última linha de defesa, para
-- o caso de alguém escrever direto no banco.

-- ── 1. A conexão passa a ter dois tipos ──────────────────────────────────────────

alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections add constraint connections_provider_check
  check (provider in ('evolution', 'cloud'));

-- Instância só existe na Evolution. Na Cloud API a identidade é o phone_number_id.
alter table public.connections alter column instance_name drop not null;

-- Identificadores da Meta. O TOKEN NÃO ENTRA AQUI: fica em META_ACCESS_TOKEN, no
-- servidor, pela mesma razão que a EVOLUTION_API_KEY nunca foi para o banco.
alter table public.connections add column if not exists phone_number_id text;
alter table public.connections add column if not exists waba_id text;

-- Dois cadastros não podem brigar pelo mesmo número da Meta.
create unique index if not exists connections_phone_number_id_uidx
  on public.connections (phone_number_id) where phone_number_id is not null;

-- Ritmo da Cloud API. Não é anti-bloqueio (não existe bloqueio aqui): é para não
-- levar 429 da Meta. O padrão oficial aguenta 80 msg/s; 10 é conservador e já dá
-- 36 mil mensagens por hora.
alter table public.connections add column if not exists msgs_por_segundo smallint not null default 10;
alter table public.connections drop constraint if exists connections_msgs_por_segundo_check;
alter table public.connections add constraint connections_msgs_por_segundo_check
  check (msgs_por_segundo >= 1 and msgs_por_segundo <= 80);

-- Só a conexão da Meta tem "qualidade", que é quem manda no teto diário real.
alter table public.connections add column if not exists qualidade text;
alter table public.connections drop constraint if exists connections_qualidade_check;
alter table public.connections add constraint connections_qualidade_check
  check (qualidade is null or qualidade in ('GREEN', 'YELLOW', 'RED', 'UNKNOWN'));

-- Coerência: cada tipo exige o seu identificador e não aceita o do outro.
alter table public.connections drop constraint if exists connections_identidade_do_provider;
alter table public.connections add constraint connections_identidade_do_provider check (
  (provider = 'evolution' and instance_name is not null and phone_number_id is null)
  or
  (provider = 'cloud' and phone_number_id is not null)
);

-- ── 2. Templates aprovados pela Meta ─────────────────────────────────────────────
--
-- A primeira mensagem para quem nunca escreveu SÓ pode ser um template aprovado — é
-- essa aprovação prévia que troca "risco de banimento" por "mensagem autorizada".
-- Guardar a lista localmente serve para o compositor mostrar o texto real e contar as
-- variáveis sem uma ida à Meta a cada tecla.

create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  -- Nome do template na Meta (`boas_vindas_expedicao`), em minúsculas e underscore.
  nome text not null,
  idioma text not null default 'pt_BR',
  categoria text not null default 'MARKETING'
    check (categoria in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status text not null default 'PENDING'
    check (status in ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL')),
  -- Texto do corpo COM os marcadores da Meta ({{1}}, {{2}}…), como ela devolve.
  corpo text not null default '',
  cabecalho_tipo text check (cabecalho_tipo in ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT')),
  cabecalho_texto text,
  rodape text,
  botoes jsonb,
  -- Quantas variáveis cada parte pede. O compositor exige exatamente esta quantidade:
  -- template com 2 variáveis e 1 preenchida é erro 132000 na hora do disparo, com a
  -- campanha inteira já em voo.
  variaveis_corpo smallint not null default 0,
  variaveis_cabecalho smallint not null default 0,
  meta_id text,
  sincronizado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists whatsapp_templates_uidx
  on public.whatsapp_templates (connection_id, nome, idioma);
create index if not exists whatsapp_templates_aprovados_idx
  on public.whatsapp_templates (connection_id) where status = 'APPROVED';

drop trigger if exists trg_whatsapp_templates_touch on public.whatsapp_templates;
create trigger trg_whatsapp_templates_touch before update on public.whatsapp_templates
for each row execute function public.touch_atualizado_em();

alter table public.whatsapp_templates enable row level security;

-- ── 3. A campanha aponta o template e o que vai em cada variável ─────────────────

alter table public.campaigns add column if not exists template_nome text;
alter table public.campaigns add column if not exists template_idioma text;
-- Mapa posição → texto: {"1": "{{primeiro_nome}}", "2": "Japão & China"}. Os mesmos
-- marcadores de personalização do e-mail valem aqui, resolvidos por destinatário.
alter table public.campaigns add column if not exists template_variaveis jsonb;
-- URL da mídia do cabeçalho, quando o template tem cabeçalho de imagem/vídeo/PDF.
alter table public.campaigns add column if not exists template_cabecalho_url text;

-- Fan-out em fatias. Até a 0018 a campanha virava fila numa tacada só: `montarDestinatarios`
-- carregava TODOS os contatos na memória e fazia um insert único. Com 38 grupos isso é
-- trivial; com 50 mil contatos estoura a memória da função e o corpo da requisição.
-- Agora a promoção corta em páginas e guarda onde parou — e `fanout_completo` impede
-- que a campanha seja dada como encerrada no meio da montagem, quando a fila ainda
-- está vazia porque os próximos 49 mil não entraram.
alter table public.campaigns add column if not exists fanout_completo boolean not null default true;
alter table public.campaigns add column if not exists fanout_cursor text;

alter table public.recorrencias add column if not exists template_nome text;
alter table public.recorrencias add column if not exists template_idioma text;
alter table public.recorrencias add column if not exists template_variaveis jsonb;
alter table public.recorrencias add column if not exists template_cabecalho_url text;

-- ── 4. A fila guarda o que foi resolvido para cada pessoa ────────────────────────

-- Variáveis já resolvidas no fan-out. Resolver aqui e não na hora do envio deixa a
-- retentativa determinística: a segunda tentativa manda exatamente o mesmo texto da
-- primeira, mesmo que o contato tenha sido editado no meio do caminho.
alter table public.campaign_recipients add column if not exists variaveis jsonb;
-- Código de erro da Meta (131026, 132001…). Sem ele, "falha" vira adivinhação: o
-- número não existe? o template foi pausado? a janela de 24 h fechou?
alter table public.campaign_recipients add column if not exists codigo_erro text;

-- ── 5. Opt-out de WhatsApp ───────────────────────────────────────────────────────
--
-- `status_whatsapp = 'descadastrado'` já existia; faltava o carimbo e um índice que
-- permita provar, numa auditoria da Meta, quando cada pedido de saída foi respeitado.
alter table public.contacts add column if not exists optout_whatsapp_em timestamptz;
create index if not exists contacts_optout_whatsapp_idx
  on public.contacts (optout_whatsapp_em) where optout_whatsapp_em is not null;

-- ── 6. A REGRA: disparo em massa para contatos só pela API oficial ───────────────

create or replace function public.exigir_api_oficial_para_contatos()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  prov text;
begin
  -- A regra vale EXATAMENTE na hora de agendar, e em nenhum outro momento.
  --
  -- Rascunho pode estar incompleto de propósito. E, tão importante quanto: o próprio
  -- motor atualiza a campanha várias vezes depois que ela sai ('enviando' → 'enviada',
  -- o `resultado`, o `fanout_cursor`). Se a regra valesse nesses updates, uma campanha
  -- antiga de contatos — das que rodavam por chip antes desta migration — faria o
  -- motor levantar exceção ao tentar fechá-la, e a campanha ficaria presa em
  -- 'enviando' para sempre.
  if new.alvo is distinct from 'contatos' or new.status is distinct from 'agendada' then
    return new;
  end if;

  if new.connection_id is null then
    raise exception 'Disparo em massa para contatos exige uma conexão da API oficial do WhatsApp (Cloud API).'
      using errcode = 'check_violation';
  end if;

  select c.provider into prov from public.connections c where c.id = new.connection_id;

  if prov is distinct from 'cloud' then
    raise exception 'Disparo em massa para contatos só sai pela API oficial do WhatsApp (Cloud API). A conexão escolhida é do tipo "%".', coalesce(prov, 'desconhecido')
      using errcode = 'check_violation';
  end if;

  if new.template_nome is null or btrim(new.template_nome) = '' then
    raise exception 'Disparo em massa para contatos exige um template aprovado pela Meta.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_campaigns_api_oficial on public.campaigns;
create trigger trg_campaigns_api_oficial
before insert or update on public.campaigns
for each row execute function public.exigir_api_oficial_para_contatos();

-- Ver 0013: `revoke ... from public` não basta no Supabase — ele concede EXECUTE
-- direto a anon e authenticated, e sem tirar dos dois a função fica chamável pelo
-- navegador com a chave pública.
revoke all on function public.exigir_api_oficial_para_contatos() from public;
revoke all on function public.exigir_api_oficial_para_contatos() from anon, authenticated;
grant execute on function public.exigir_api_oficial_para_contatos() to service_role;

-- ── 7. Reivindicar e registrar em LOTE ───────────────────────────────────────────
--
-- O motor da Evolution trabalha de uma em uma: com 8–15 s entre mensagens, uma ida ao
-- banco por envio não custa nada. A API oficial manda dezenas por segundo, e aí duas
-- idas ao banco por mensagem viram o gargalo — 50 mil mensagens seriam 100 mil
-- requisições HTTP ao PostgREST.
--
-- Estas duas funções trocam isso por DUAS chamadas por lote:
--   • `reivindicar_lote_whatsapp` pega N linhas e já as marca como 'enviando';
--   • `registrar_envios_whatsapp` grava o desfecho das N de uma vez.
--
-- `for update skip locked` é o que substitui a corrida linha a linha: dois ticks
-- simultâneos levam lotes DIFERENTES, sem travar um ao outro e sem enviar duplicado.

create or replace function public.reivindicar_lote_whatsapp(p_conexao uuid, p_limite int)
returns table (
  id uuid,
  campaign_id uuid,
  destino text,
  destino_nome text,
  tentativas smallint,
  variaveis jsonb
)
language sql
security definer
set search_path = public
as $fn$
  update public.campaign_recipients r
     set status = 'enviando',
         tentativas = r.tentativas + 1
   where r.id in (
     select r2.id
       from public.campaign_recipients r2
       join public.campaigns c on c.id = r2.campaign_id
      where r2.connection_id = p_conexao
        and r2.status = 'pendente'
        and c.status = 'enviando'
      order by r2.criado_em
      limit greatest(1, least(p_limite, 500))
      for update of r2 skip locked
   )
  returning r.id, r.campaign_id, r.destino, r.destino_nome, r.tentativas, r.variaveis;
$fn$;

-- Desfecho do lote. Cada item: {id, status, provider_message_id, erro, codigo_erro}.
create or replace function public.registrar_envios_whatsapp(p_resultados jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  afetadas integer;
begin
  update public.campaign_recipients r
     set status = d.status,
         provider_message_id = coalesce(d.provider_message_id, r.provider_message_id),
         erro = d.erro,
         codigo_erro = d.codigo_erro,
         -- Só carimba a saída quando ela de fato aconteceu; retentativa não apaga o
         -- carimbo anterior, senão o limite diário por número passaria a contar errado.
         enviado_em = case when d.status = 'enviado' then now() else r.enviado_em end
    from jsonb_to_recordset(p_resultados) as d(
      id uuid,
      status text,
      provider_message_id text,
      erro text,
      codigo_erro text
    )
   where r.id = d.id;

  get diagnostics afetadas = row_count;
  return afetadas;
end;
$fn$;

revoke all on function public.reivindicar_lote_whatsapp(uuid, int) from public;
revoke all on function public.reivindicar_lote_whatsapp(uuid, int) from anon, authenticated;
grant execute on function public.reivindicar_lote_whatsapp(uuid, int) to service_role;

revoke all on function public.registrar_envios_whatsapp(jsonb) from public;
revoke all on function public.registrar_envios_whatsapp(jsonb) from anon, authenticated;
grant execute on function public.registrar_envios_whatsapp(jsonb) to service_role;

-- A fila cresceu de 38 grupos para dezenas de milhares de linhas: sem este índice, cada
-- lote reivindicado vira varredura da tabela inteira.
create index if not exists campaign_recipients_fila_idx
  on public.campaign_recipients (connection_id, criado_em) where status = 'pendente';

-- O teto diário por número passa a ser contado sobre uma tabela grande: sem índice,
-- cada tick varreria a fila inteira só para saber quantas saíram hoje.
create index if not exists campaign_recipients_enviadas_dia_idx
  on public.campaign_recipients (connection_id, enviado_em) where enviado_em is not null;

-- ── 8. Janela de horário, lote e alerta ──────────────────────────────────────────
-- O motor passa a LER estas chaves. Até a 0018 elas eram escritas pela tela
-- Configurações e ignoradas por todo mundo.
update public.app_settings
set valor = valor || jsonb_build_object(
      'lote_whatsapp', coalesce(valor -> 'lote_whatsapp', '200'::jsonb),
      'alerta_email',  coalesce(valor -> 'alerta_email',  '""'::jsonb)
    )
where chave = 'envio';
