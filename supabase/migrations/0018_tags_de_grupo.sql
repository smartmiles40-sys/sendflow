-- supabase/migrations/0018_tags_de_grupo.sql
-- Tags (etiquetas) de grupo: "Live Peru", "Turma Japão março", "Comunidade"…
--
-- Por que não bastava o Público salvo: o público é uma LISTA FECHADA para disparo. A
-- tag é para organizar — um grupo pode ter várias, a mesma tag filtra a tela Grupos, o
-- Celular e marca de uma vez todos os grupos dela na hora de escolher o destino.
--
-- Tabela de ligação em vez de array em `groups`: apagar a tag solta os grupos sozinho
-- (on delete cascade), sem varrer array nenhum.

create table if not exists public.group_tags (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cor text not null default '#D7F264' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  criado_em timestamptz not null default now()
);

-- Nome único sem diferenciar maiúscula: "live peru" e "Live Peru" são a mesma tag.
create unique index if not exists group_tags_nome_uidx on public.group_tags (lower(nome));

create table if not exists public.group_tag_links (
  group_id uuid not null references public.groups(id) on delete cascade,
  tag_id uuid not null references public.group_tags(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (group_id, tag_id)
);

create index if not exists group_tag_links_tag_idx on public.group_tag_links (tag_id);

-- RLS sem policies: só o service_role (rotas da API) acessa, igual às outras tabelas.
alter table public.group_tags enable row level security;
alter table public.group_tag_links enable row level security;
