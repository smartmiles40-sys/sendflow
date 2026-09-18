-- supabase/migrations/0016_cadencias.sql
-- Cadência: uma sequência de mensagens com data e hora ABSOLUTAS, desenhada numa tela
-- só (mensagem 1 → mensagem 2 → …), para o mesmo destino.
--
-- Por que não reaproveitar `sequences`: a sequência é um MOLDE relativo à data de uma
-- aula ("2 dias antes, às 8h") que gera campanhas soltas e esquece delas. A cadência é o
-- contrário — cada passo tem data marcada e continua ligado a ela, para a tela mostrar
-- o que já saiu, o que está na fila e deixar editar o que ainda não foi.
--
-- Cada passo é uma linha comum de `campaigns` (com cadencia_id). Assim o motor de envio,
-- a fila por destinatário e os KPIs funcionam sem uma linha de código nova no worker.
-- A cadência guarda o DESTINO; o app copia o destino para cada passo não enviado.

create table if not exists public.cadencias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'avulsas'
    check (categoria in ('lives','expedicoes','comunidade','avulsas')),
  alvo text not null default 'grupos' check (alvo in ('grupos','contatos')),
  audience_id uuid references public.audiences(id) on delete set null,
  group_ids text[],
  list_ids uuid[],
  connection_id uuid references public.connections(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- RLS sem policies: só o service_role (rotas da API) acessa, igual às outras tabelas.
alter table public.cadencias enable row level security;

drop trigger if exists trg_cadencias_touch on public.cadencias;
create trigger trg_cadencias_touch before update on public.cadencias
for each row execute function public.touch_atualizado_em();

-- on delete set null: apagar a cadência preserva o histórico do que já foi enviado.
-- (A API apaga antes os passos que ainda não saíram.)
alter table public.campaigns add column if not exists cadencia_id uuid
  references public.cadencias(id) on delete set null;

create index if not exists campaigns_cadencia_idx
  on public.campaigns (cadencia_id, enviar_em)
  where cadencia_id is not null;
