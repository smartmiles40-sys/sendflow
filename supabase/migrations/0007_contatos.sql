-- supabase/migrations/0007_contatos.sql
-- Contatos e listas — a base compartilhada pelos DOIS canais.
--
-- Decisão central: NÃO existe "contato de e-mail" e "contato de WhatsApp" separados.
-- É a mesma pessoa, com e-mail e/ou telefone, e cada canal tem o seu próprio status de
-- permissão. Assim "quem abriu o e-mail e também leu o WhatsApp" é uma pergunta que o
-- banco responde — que é justamente o tipo de KPI que justifica o sistema.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  nome text,
  email text,
  telefone text,                            -- só dígitos, com DDI: 5511999999999
  empresa text,
  tags text[] not null default '{}',

  -- Permissão por canal. 'bounce' e 'spam' são decisões do provedor de e-mail
  -- (chegam pelo webhook) e valem como descadastro: nunca mais mandamos para lá.
  status_email text not null default 'ativo'
    check (status_email in ('ativo','descadastrado','bounce','spam')),
  status_whatsapp text not null default 'ativo'
    check (status_whatsapp in ('ativo','descadastrado','invalido')),

  origem text,                              -- 'importacao-csv', 'formulario', 'manual'…
  campos jsonb not null default '{}'::jsonb, -- campos livres p/ personalizar mensagem
  descadastrado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Um contato precisa de pelo menos um jeito de ser alcançado.
  constraint contacts_tem_canal check (email is not null or telefone is not null)
);

-- Dois contatos não podem repetir o mesmo e-mail nem o mesmo telefone. No Postgres
-- NULLs são distintos entre si, então nulo continua livre — um contato só-de-WhatsApp
-- (sem e-mail) nunca colide com outro.
--
-- Índices SEM predicado e sobre a coluna crua, de propósito: o PostgREST só resolve
-- ON CONFLICT contra um índice simples. Com `where email is not null` ou `lower(email)`,
-- o upsert da importação de CSV falharia com "no unique constraint matching".
-- O preço é que a normalização (minúsculas, sem espaço) tem de ser feita na aplicação,
-- em `normalizarEmail()` — e é, em todo caminho que escreve contato.
create unique index if not exists contacts_email_idx on public.contacts (email);
create unique index if not exists contacts_telefone_idx on public.contacts (telefone);
create index if not exists contacts_tags_idx on public.contacts using gin (tags);

drop trigger if exists trg_contacts_touch on public.contacts;
create trigger trg_contacts_touch before update on public.contacts
for each row execute function public.touch_atualizado_em();

-- Listas: o "público" do e-mail e, opcionalmente, do WhatsApp por telefone.
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  cor text not null default '#2E6BFF',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

drop trigger if exists trg_lists_touch on public.lists;
create trigger trg_lists_touch before update on public.lists
for each row execute function public.touch_atualizado_em();

create table if not exists public.list_members (
  list_id uuid not null references public.lists(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (list_id, contact_id)
);

create index if not exists list_members_contact_idx on public.list_members (contact_id);

alter table public.contacts     enable row level security;
alter table public.lists        enable row level security;
alter table public.list_members enable row level security;
