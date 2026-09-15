-- supabase/migrations/0009_email.sql
-- E-mail marketing: campanhas, fila de destinatários e o log cru de eventos.
--
-- O espelho exato do WhatsApp: a campanha é o molde, `email_recipients` é a fila com uma
-- linha por pessoa, e é nela que ficam os carimbos que viram KPI. A diferença é o funil:
-- e-mail tem ABERTURA e CLIQUE, que o WhatsApp não tem, e tem BOUNCE/SPAM, que são
-- veredictos do provedor e valem como descadastro automático.

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                       -- nome interno, só a equipe vê
  assunto text not null,                    -- a linha que decide se abre ou não
  preheader text,                           -- o trecho cinza depois do assunto na caixa de entrada
  remetente_nome text not null,
  remetente_email text not null,
  responder_para text,

  html text not null default '',
  -- Versão em texto puro. Obrigatória para entregabilidade: e-mail só-HTML é um dos
  -- sinais clássicos de spam. Se vier vazia, o app deriva do HTML na hora de enviar.
  texto text,

  list_ids uuid[] not null default '{}',
  -- Filtro opcional por tag dentro das listas escolhidas.
  tags text[] not null default '{}',

  status text not null default 'rascunho'
    check (status in ('rascunho','agendada','enviando','enviada','cancelada','erro')),
  enviar_em timestamptz,
  enviado_em timestamptz,

  -- Teste A/B do assunto: quando preenchido, metade da fila recebe `assunto_b`
  -- e o painel mostra qual das duas linhas ganhou em abertura.
  assunto_b text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists email_campaigns_due_idx
  on public.email_campaigns (status, enviar_em);

drop trigger if exists trg_email_campaigns_touch on public.email_campaigns;
create trigger trg_email_campaigns_touch before update on public.email_campaigns
for each row execute function public.touch_atualizado_em();

create table if not exists public.email_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  email text not null,
  nome text,

  -- Identificador público desta pessoa NESTA campanha. Vai no pixel, nos links e no
  -- link de descadastro. É opaco de propósito: quem recebe o e-mail nunca vê um id do
  -- banco, e um token não permite descobrir os outros.
  token text not null unique,
  -- 'A' ou 'B' quando a campanha tem teste de assunto.
  variante char(1) not null default 'A' check (variante in ('A','B')),

  -- O funil de e-mail, em ordem:
  --   pendente → enviando → enviado → entregue → aberto → clicado
  -- 'bounce' (caixa inexistente/cheia) e 'spam' (marcou como spam) são becos sem saída.
  status text not null default 'pendente'
    check (status in ('pendente','enviando','enviado','entregue','aberto','clicado',
                      'bounce','spam','falha','cancelado')),
  tentativas smallint not null default 0,
  provider_message_id text,
  erro text,

  enviado_em timestamptz,
  entregue_em timestamptz,
  primeiro_aberto_em timestamptz,
  ultimo_aberto_em timestamptz,
  primeiro_clique_em timestamptz,
  -- Contadores acumulados: "abriu 4 vezes" é sinal de interesse forte.
  aberturas integer not null default 0,
  cliques integer not null default 0,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Sem `lower()`: o PostgREST precisa de um índice simples para o ON CONFLICT do
-- fan-out. O e-mail já chega em minúsculas de `normalizarEmail()`.
create unique index if not exists email_recipients_unico_idx
  on public.email_recipients (campaign_id, email);
create index if not exists email_recipients_fila_idx
  on public.email_recipients (status, campaign_id)
  where status in ('pendente','enviando');
create index if not exists email_recipients_msgid_idx
  on public.email_recipients (provider_message_id)
  where provider_message_id is not null;
create index if not exists email_recipients_campanha_idx
  on public.email_recipients (campaign_id);
create index if not exists email_recipients_contato_idx
  on public.email_recipients (contact_id);

drop trigger if exists trg_email_recipients_touch on public.email_recipients;
create trigger trg_email_recipients_touch before update on public.email_recipients
for each row execute function public.touch_atualizado_em();

-- Log cru: uma linha por evento, sem sobrescrever nada. `email_recipients` guarda o
-- estado atual (rápido de agregar); esta tabela guarda a história (qual link, quando,
-- de qual aparelho) — é dela que sai o ranking de links mais clicados.
create table if not exists public.email_events (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.email_recipients(id) on delete cascade,
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  tipo text not null
    check (tipo in ('enviado','entregue','aberto','clicado','bounce','spam',
                    'descadastro','falha')),
  url text,                                 -- preenchido em 'clicado'
  user_agent text,
  ip text,
  detalhe text,
  criado_em timestamptz not null default now()
);

create index if not exists email_events_campanha_tipo_idx
  on public.email_events (campaign_id, tipo);
create index if not exists email_events_recipient_idx
  on public.email_events (recipient_id);
create index if not exists email_events_criado_idx
  on public.email_events (criado_em);

-- Modelos de e-mail prontos. Bruno não é de marketing: o valor aqui é começar de um
-- layout que já é responsivo, tem cabeçalho/rodapé corretos e link de descadastro,
-- em vez de uma folha em branco.
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  assunto_sugerido text,
  html text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

drop trigger if exists trg_email_templates_touch on public.email_templates;
create trigger trg_email_templates_touch before update on public.email_templates
for each row execute function public.touch_atualizado_em();

alter table public.email_campaigns  enable row level security;
alter table public.email_recipients enable row level security;
alter table public.email_events     enable row level security;
alter table public.email_templates  enable row level security;
