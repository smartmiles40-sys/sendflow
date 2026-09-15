-- supabase/migrations/0008_fila_whatsapp.sql
-- A fila de envio do WhatsApp — uma linha por DESTINATÁRIO, não por campanha.
--
-- Por que isso muda tudo:
--
-- 1. KPI. Antes, o resultado da campanha era um contador cego em `campaigns.resultado`
--    ({total, enviados, falhas}). Agora cada grupo/contato tem o seu próprio estado e os
--    seus próprios carimbos de tempo — entregue às 09:01, lido às 09:14. Sem isso não
--    existe "taxa de leitura".
-- 2. Retomada. O envio deixa de ser um processo longo que, se cair no meio, não se sabe
--    onde parou. Cada tick do motor pega os pendentes e continua de onde estava.
-- 3. Anti-bloqueio. O ritmo é por conexão (`connections.proximo_envio_em`), então o
--    intervalo de 8–15s entre mensagens sobrevive a invocações serverless independentes.

create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,

  destino text not null,                    -- JID do grupo (…@g.us) ou telefone só-dígitos
  destino_nome text,
  destino_tipo text not null default 'grupo' check (destino_tipo in ('grupo','contato')),
  contact_id uuid references public.contacts(id) on delete set null,

  -- O funil de uma mensagem de WhatsApp, em ordem:
  --   pendente → enviando → enviado → entregue → lido
  -- 'falha' é terminal depois das tentativas; 'cancelado' é quando a campanha é abortada.
  status text not null default 'pendente'
    check (status in ('pendente','enviando','enviado','entregue','lido','falha','cancelado')),
  tentativas smallint not null default 0,
  -- ID da mensagem na Evolution/WhatsApp. É por ele que o webhook de ACK encontra a linha
  -- para carimbar entregue/lido — sem isso não há como ligar o retorno ao destinatário.
  provider_message_id text,
  erro text,

  enviado_em timestamptz,
  entregue_em timestamptz,
  lido_em timestamptz,
  respondido_em timestamptz,                -- o contato respondeu (o KPI mais valioso)
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Idempotência do fan-out: rodar duas vezes não duplica destinatário na mesma campanha.
create unique index if not exists campaign_recipients_unico_idx
  on public.campaign_recipients (campaign_id, destino);

-- O índice que o worker usa a cada tick: "o que ainda falta enviar".
create index if not exists campaign_recipients_fila_idx
  on public.campaign_recipients (status, connection_id)
  where status in ('pendente','enviando');

-- O índice que o webhook usa para achar a linha pelo ID da mensagem.
create index if not exists campaign_recipients_msgid_idx
  on public.campaign_recipients (provider_message_id)
  where provider_message_id is not null;

create index if not exists campaign_recipients_campanha_idx
  on public.campaign_recipients (campaign_id);

-- Contagem diária por conexão (limite_diario) sem varrer a tabela inteira.
create index if not exists campaign_recipients_conexao_dia_idx
  on public.campaign_recipients (connection_id, enviado_em)
  where enviado_em is not null;

drop trigger if exists trg_campaign_recipients_touch on public.campaign_recipients;
create trigger trg_campaign_recipients_touch before update on public.campaign_recipients
for each row execute function public.touch_atualizado_em();

-- Campanha ganha o alvo: grupos (como sempre) ou contatos de uma lista (novo).
alter table public.campaigns add column if not exists alvo text not null default 'grupos'
  check (alvo in ('grupos','contatos'));
alter table public.campaigns add column if not exists list_ids uuid[];

alter table public.campaign_recipients enable row level security;
