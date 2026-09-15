-- supabase/migrations/0006_connections.sql
-- Conexões de WhatsApp (Evolution API).
--
-- Cada linha é UMA instância na Evolution: um número de celular conectado por QR Code.
-- O que era "o motor n8n + Z-API" (fora do sistema, um número só, token escondido numa
-- credencial do n8n) passa a ser um recurso de primeira classe do app: você cadastra,
-- conecta, vê o status e distribui o disparo entre vários números.
--
-- O segredo (EVOLUTION_API_KEY) continua NO SERVIDOR, em variável de ambiente — o banco
-- guarda só o nome da instância, que não dá acesso a nada sozinho.

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                       -- rótulo humano: "Comercial 1", "Suporte"
  provider text not null default 'evolution'
    check (provider in ('evolution')),
  -- Nome da instância na Evolution API. É a chave de tudo: as rotas da Evolution são
  -- /message/sendText/{instance}. Único para dois cadastros não brigarem pela mesma instância.
  instance_name text not null unique,
  numero text,                              -- número conectado, só dígitos (5511999999999)
  profile_name text,
  profile_pic_url text,
  status text not null default 'desconectada'
    check (status in ('desconectada','conectando','conectada','erro')),

  -- Anti-bloqueio: intervalo aleatório entre um envio e o próximo NESTA conexão.
  -- O motor respeita isso por conexão — dois números disparam em paralelo, cada um no seu ritmo.
  delay_min_seg smallint not null default 8  check (delay_min_seg >= 1 and delay_min_seg <= 300),
  delay_max_seg smallint not null default 15 check (delay_max_seg >= 1 and delay_max_seg <= 600),
  -- Teto de mensagens por dia (00:00–23:59 em São Paulo). 0 = sem limite.
  limite_diario integer not null default 500 check (limite_diario >= 0),

  ativo boolean not null default true,
  -- Momento em que a conexão pode voltar a enviar. O motor grava aqui depois de cada
  -- mensagem (agora + jitter); é o que materializa o delay entre invocações do worker,
  -- já que cada tick é um processo novo e não tem memória do anterior.
  proximo_envio_em timestamptz,
  ultima_sincronizacao timestamptz,         -- último "puxar grupos" bem-sucedido
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint connections_delay_coerente check (delay_max_seg >= delay_min_seg)
);

drop trigger if exists trg_connections_touch on public.connections;
create trigger trg_connections_touch before update on public.connections
for each row execute function public.touch_atualizado_em();

-- Grupos passam a pertencer a uma conexão: um grupo só existe no WhatsApp do número
-- que participa dele. Nulo = grupo legado, cadastrado à mão antes das conexões.
alter table public.groups add column if not exists connection_id uuid
  references public.connections(id) on delete cascade;
alter table public.groups add column if not exists participantes integer;
alter table public.groups add column if not exists foto_url text;
alter table public.groups add column if not exists sincronizado_em timestamptz;

-- O group_id era unique global (herança do Z-API, que tinha um número só). Com várias
-- conexões o MESMO grupo pode aparecer em dois números — a unicidade correta é o par.
alter table public.groups drop constraint if exists groups_group_id_key;
create unique index if not exists groups_conexao_grupo_idx
  on public.groups (coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid), group_id);

create index if not exists groups_connection_idx on public.groups (connection_id) where ativo;

-- Por qual número esta campanha sai. Nulo = o motor escolhe a primeira conexão conectada.
alter table public.campaigns add column if not exists connection_id uuid
  references public.connections(id) on delete set null;
alter table public.recorrencias add column if not exists connection_id uuid
  references public.connections(id) on delete set null;

alter table public.connections enable row level security;
