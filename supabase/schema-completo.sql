-- ═════════════════════════════════════════════════════════════════════════════
-- SendFlow — banco completo, num arquivo só
--
-- COMO USAR
--   1. Crie um projeto no Supabase (supabase.com).
--   2. Abra SQL Editor → New query.
--   3. Cole ESTE arquivo inteiro e clique em Run.
--   4. Storage → New bucket → nome `campanhas-midia`, marque **Public**.
--   5. Settings → API → copie a Project URL e a service_role key para o .env.local:
--        NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
--        SUPABASE_SERVICE_ROLE_KEY=...
--   6. Reinicie o `npm run dev` (variável de ambiente não recarrega sozinha).
--
-- É o mesmo conteúdo de supabase/migrations/, na ordem, concatenado. Rodar as
-- migrations uma a uma dá exatamente no mesmo — este arquivo é só conveniência.
--
-- Pode rodar de novo com segurança: tudo é `if not exists` / `create or replace`.
-- Os únicos comandos destrutivos são `drop trigger` seguidos de recriação, e o
-- `drop constraint if exists groups_group_id_key`, que é intencional (com vários
-- números, o mesmo grupo pode aparecer em dois, então a unicidade correta é o par).
--
-- GERADO AUTOMATICAMENTE — não edite aqui. Mexa nas migrations e gere de novo com:
--   npm run schema
-- ═════════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════════
-- 0001_init.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0001_init.sql

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  group_id text not null unique,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.audiences (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('todos','manual')),
  -- group_ids: Z-API group IDs. Intentionally NOT a FK to groups.group_id — validated at write time in the API layer.
  group_ids text[],
  criado_em timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null check (tipo in ('texto','imagem','video','pdf')),
  mensagem text not null,
  midia_url text,
  mencionar_todos boolean not null default false,
  audience_id uuid references public.audiences(id) on delete set null,
  -- on delete set null; revisit to 'restrict' when an audience-delete UI ships so a scheduled campaign can't silently lose its target.
  enviar_em timestamptz,
  status text not null default 'rascunho'
    check (status in ('rascunho','agendada','enviando','enviada','cancelada','erro')),
  resultado jsonb,
  enviado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists campaigns_due_idx
  on public.campaigns (status, enviar_em);

create or replace function public.touch_atualizado_em()
returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end; $$;

drop trigger if exists trg_campaigns_touch on public.campaigns;
create trigger trg_campaigns_touch before update on public.campaigns
for each row execute function public.touch_atualizado_em();

-- RLS enabled with NO policies: service_role (API routes + n8n) bypasses RLS. Add anon/auth policies when login ships.
alter table public.groups   enable row level security;
alter table public.audiences enable row level security;
alter table public.campaigns enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0002_campaign_group_ids.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- Ad-hoc group selection for a single campaign (overrides audience when set).
alter table public.campaigns add column if not exists group_ids text[];

-- ═════════════════════════════════════════════════════════════════════════════
-- 0003_campaign_categoria.sql
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.campaigns
  add column if not exists categoria text not null default 'avulsas'
  check (categoria in ('agentepro','academy','p360','avulsas'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 0004_sequences.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0004_sequences.sql
-- Roteiros reutilizáveis ("Sequências de Aula"). Cada linha é um roteiro (nome + categoria)
-- cujos passos (steps jsonb) são renderizados e agendados como campanhas individuais no dispatch.

create table if not exists public.sequences (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'academy'
    check (categoria in ('agentepro','academy','p360','avulsas')),
  steps jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- RLS enabled with NO policies: service_role (API routes) bypasses RLS, igual às outras tabelas.
alter table public.sequences enable row level security;

-- Mantém atualizado_em em dia (reusa a função criada em 0001_init.sql).
drop trigger if exists trg_sequences_touch on public.sequences;
create trigger trg_sequences_touch before update on public.sequences
for each row execute function public.touch_atualizado_em();

-- Semeia o roteiro da Academy (10 passos), apenas se ainda não existir uma sequência 'academy'.
-- Os \n no JSON viram quebras de linha reais no texto ao fazer o cast ::jsonb / extrair com ->>.
insert into public.sequences (nome, categoria, steps)
select 'Academy', 'academy', $json$[
  {
    "id": "s1",
    "ordem": 0,
    "dia_offset": -3,
    "hora_tipo": "fixo",
    "hora_fixa": "08:00",
    "offset_min": null,
    "mensagem": "Bom dia, pessoal! ☀️ Tudo bem por aí?\n\nPassando aqui pra dar aquele aviso imperdível: essa semana tem AULA ao vivo! 🎉\n\nE o tema está sensacional.\n\nJá vai separando o horário e avisando quem ainda não viu essa mensagem, porque serão aulas incríveis e a gente não quer ninguém de fora não! 👊\n\nAnota aí o horário, estaremos esperando vocês!",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s2",
    "ordem": 1,
    "dia_offset": -2,
    "hora_tipo": "fixo",
    "hora_fixa": "12:00",
    "offset_min": null,
    "mensagem": "Passando pra reforçar: nossa aula ao vivo é {{diasemana}} ({{data}}), às {{hora}}.\n\nTema: {{tema}}\n\nSepara esse horário aí. 😉",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s3",
    "ordem": 2,
    "dia_offset": -1,
    "hora_tipo": "fixo",
    "hora_fixa": "18:00",
    "offset_min": null,
    "mensagem": "Faaala pessoal, tudo certo por aí?\n\nLembrando que amanhã tem aula ao vivo e a gente quer ver todo mundo presente! 🔥\n\nTema da semana: {{tema}}\n\nSepara um tempinho no seu dia e vem com a gente, porque quem participa ao vivo sempre leva muito mais do que quem assiste depois na gravação. 😉\n\n{{diasemana}}, às {{hora}} — anota e coloca no alarme, estaremos te esperando! ⏰💪",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s4",
    "ordem": 3,
    "dia_offset": 0,
    "hora_tipo": "fixo",
    "hora_fixa": "08:00",
    "offset_min": null,
    "mensagem": "Faaala pessoal, tudo certo por aí?\n\nLembrando que hoje tem aula ao vivo e a gente quer ver todo mundo presente! 🔥\n\nO tema vai ser *\"{{tema}}\"*\n\nSepara um tempinho no seu dia, fecha o que tiver aberto antes da reunião e vem com a gente. 😉\n\nHoje às {{hora}} — anota e coloca no alarme, estaremos te esperando! ⏰💪",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s5",
    "ordem": 4,
    "dia_offset": 0,
    "hora_tipo": "fixo",
    "hora_fixa": "12:00",
    "offset_min": null,
    "mensagem": "Pessoal, o Fialho mandou um recado especial pra vocês hoje! 👆\n\nHoje é dia de aula ao vivo! 🚀 A gente se encontra às {{hora}}. Queremos ver todo mundo presente, animado e pronto pra aprender muito. Não percam! 🔥",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s6",
    "ordem": 5,
    "dia_offset": 0,
    "hora_tipo": "relativo",
    "hora_fixa": null,
    "offset_min": -60,
    "mensagem": "Ei galera, é HOJE! 🚨 Falta 1 hora pra nossa aula ao vivo!\n\nTermina o que estiver fazendo, pega seu caderno, sua água e se prepara, porque às {{hora}} a gente começa e vai ser incrível! 👊🔥\n\nNão deixa passar, te esperamos lá! 🚀",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s7",
    "ordem": 6,
    "dia_offset": 0,
    "hora_tipo": "relativo",
    "hora_fixa": null,
    "offset_min": 0,
    "mensagem": "Estamos esperando vocês, pessoal! 👊\n\nJá iremos começar, entra agora para não perder nenhum conteúdo! 🚀🔥\n\nhttps://turis.inovvatur.com.br/checkin",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s8",
    "ordem": 7,
    "dia_offset": 0,
    "hora_tipo": "relativo",
    "hora_fixa": null,
    "offset_min": 5,
    "mensagem": "Pessoal, vamos esperar mais 5 min para começar, não percam! 🚀🔥\n\nhttps://turis.inovvatur.com.br/checkin",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s9",
    "ordem": 8,
    "dia_offset": 0,
    "hora_tipo": "relativo",
    "hora_fixa": null,
    "offset_min": 10,
    "mensagem": "Já estamos começando, pessoal! Estamos esperando vocês. 🚀🔥\n\nhttps://turis.inovvatur.com.br/checkin",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  },
  {
    "id": "s10",
    "ordem": 9,
    "dia_offset": 0,
    "hora_tipo": "relativo",
    "hora_fixa": null,
    "offset_min": 20,
    "mensagem": "Último aviso, pessoal, não percam. 🚀🔥\n\nhttps://turis.inovvatur.com.br/checkin",
    "tipo": "texto",
    "midia_url": null,
    "mencionar_todos": false
  }
]$json$::jsonb
where not exists (select 1 from public.sequences where categoria = 'academy');

-- ═════════════════════════════════════════════════════════════════════════════
-- 0005_recorrencias.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0005_recorrencias.sql
-- Campanhas recorrentes: um molde que dispara toda semana num dia fixo (ex.: P360 toda segunda).
-- O refill materializa as próximas ocorrências como campanhas 'agendada' normais; o cron de 1 min
-- do n8n envia como qualquer outra agendada — nada muda no motor de envio.

create table if not exists public.recorrencias (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'p360'
    check (categoria in ('agentepro','academy','p360','avulsas')),
  dia_semana smallint not null check (dia_semana between 0 and 6),  -- 0 = domingo
  hora text not null,                                               -- 'HH:MM' (America/Sao_Paulo)
  tipo text not null default 'texto' check (tipo in ('texto','imagem','video','pdf')),
  mensagem text not null,
  midia_url text,
  mencionar_todos boolean not null default false,
  audience_id uuid references public.audiences(id) on delete set null,
  group_ids text[],
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- RLS enabled with NO policies: service_role (API routes) bypassa RLS, igual às outras tabelas.
alter table public.recorrencias enable row level security;

-- Mantém atualizado_em em dia (reusa a função criada em 0001_init.sql).
drop trigger if exists trg_recorrencias_touch on public.recorrencias;
create trigger trg_recorrencias_touch before update on public.recorrencias
for each row execute function public.touch_atualizado_em();

-- Vínculo da campanha gerada com o molde. on delete set null: apagar a recorrência
-- preserva o histórico das campanhas já enviadas.
alter table public.campaigns add column if not exists recorrencia_id uuid
  references public.recorrencias(id) on delete set null;

-- Torna o refill idempotente: rodar dez vezes no mesmo dia não duplica ocorrências.
-- Índice total (sem WHERE) de propósito: PostgREST só resolve ON CONFLICT contra um índice
-- sem predicado, e no Postgres NULLs são distintos entre si — campanhas comuns
-- (recorrencia_id null) nunca colidem, mesmo com o mesmo enviar_em.
create unique index if not exists campaigns_recorrencia_ocorrencia_idx
  on public.campaigns (recorrencia_id, enviar_em);

-- ═════════════════════════════════════════════════════════════════════════════
-- 0006_connections.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0007_contatos.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0008_fila_whatsapp.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0009_email.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0010_kpis.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0011_settings_e_modelos.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0011_settings_e_modelos.sql
-- Configurações do app + os modelos de e-mail que já vêm prontos.

-- Chave/valor em jsonb: cabe um campo novo sem migration. Aqui NÃO entra segredo —
-- senha e chave de API moram em variável de ambiente, fora do banco.
create table if not exists public.app_settings (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

drop trigger if exists trg_app_settings_touch on public.app_settings;
create trigger trg_app_settings_touch before update on public.app_settings
for each row execute function public.touch_atualizado_em();

-- A função toca `atualizado_em`; a tabela usa o mesmo nome de coluna, então serve.
alter table public.app_settings enable row level security;

insert into public.app_settings (chave, valor) values
  ('email_remetente', '{
     "nome": "",
     "email": "",
     "responder_para": "",
     "rodape_endereco": "",
     "rodape_texto": "Você recebeu este e-mail porque se cadastrou em um de nossos canais."
   }'::jsonb)
on conflict (chave) do nothing;

insert into public.app_settings (chave, valor) values
  ('envio', '{
     "janela_inicio": "08:00",
     "janela_fim": "21:00",
     "respeitar_janela": false,
     "lote_email": 25
   }'::jsonb)
on conflict (chave) do nothing;

-- ── Modelos de e-mail ────────────────────────────────────────────────────────────
-- Três layouts que já resolvem o básico de entregabilidade e de leitura no celular:
-- tabela de largura fixa (Outlook não entende flexbox), largura máxima de 600px,
-- fonte de sistema, botão que é uma <table> (não um <a> estilizado, que o Outlook
-- desmonta) e um rodapé com o link de descadastro, que o app injeta no lugar de
-- {{descadastro}}. As variáveis {{nome}}, {{email}} e {{empresa}} são trocadas pelos
-- dados do contato no momento do envio.

insert into public.email_templates (nome, descricao, assunto_sugerido, html)
select 'Anúncio simples',
       'Um aviso direto: título, texto e um botão. O que mais converte quando você tem uma coisa só para dizer.',
       'Novidade: {{empresa}} tem um aviso para você',
$html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0147FF;padding:22px 28px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.08em;">SUA MARCA</p>
      </td></tr>
      <tr><td style="padding:32px 28px 8px;">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#0A0F1F;">Olá, {{nome}}!</h1>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d4660;">
          Escreva aqui o recado principal. Uma ideia por parágrafo, frases curtas — e-mail
          se lê no celular, em pé, com pressa.
        </p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3d4660;">
          Um segundo parágrafo, se precisar. Depois disso, o botão.
        </p>
      </td></tr>
      <tr><td align="center" style="padding:0 28px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="background:#0147FF;border-radius:10px;">
            <a href="https://exemplo.com.br" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Quero saber mais</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px 28px;background:#f4f6fb;font-size:12px;line-height:1.6;color:#7c86a0;">
        {{rodape}}
      </td></tr>
    </table>
  </td></tr>
</table>$html$
where not exists (select 1 from public.email_templates where nome = 'Anúncio simples');

insert into public.email_templates (nome, descricao, assunto_sugerido, html)
select 'Convite para evento ou aula',
       'Data, hora e link em destaque. Feito para a pessoa entender em 3 segundos quando é e onde entra.',
       '{{nome}}, sua vaga na aula desta semana',
$html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0A0F1F;padding:26px 28px;text-align:center;">
        <p style="margin:0 0 6px;color:#7fa6ff;font-size:12px;font-weight:700;letter-spacing:.14em;">AULA AO VIVO</p>
        <h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.25;">Tema da aula aqui</h1>
      </td></tr>
      <tr><td style="padding:26px 28px 6px;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#3d4660;">
          Oi, {{nome}}! Sua vaga está garantida. Anote os detalhes:
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;border-radius:10px;">
          <tr>
            <td style="padding:16px 18px;font-size:15px;line-height:1.7;color:#0A0F1F;">
              <strong>Quando:</strong> quinta-feira, 19h30<br>
              <strong>Onde:</strong> ao vivo, link abaixo<br>
              <strong>Duração:</strong> cerca de 1 hora
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:24px 28px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="background:#00a37a;border-radius:10px;">
            <a href="https://exemplo.com.br/aula" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Entrar na aula</a>
          </td>
        </tr></table>
        <p style="margin:14px 0 0;font-size:13px;color:#7c86a0;">Salve este e-mail — o link é o mesmo no dia.</p>
      </td></tr>
      <tr><td style="padding:20px 28px;background:#f4f6fb;font-size:12px;line-height:1.6;color:#7c86a0;">
        {{rodape}}
      </td></tr>
    </table>
  </td></tr>
</table>$html$
where not exists (select 1 from public.email_templates where nome = 'Convite para evento ou aula');

insert into public.email_templates (nome, descricao, assunto_sugerido, html)
select 'Texto puro (o que mais chega na caixa de entrada)',
       'Sem imagem e sem botão colorido: parece e-mail de pessoa, não de sistema. Costuma ser o que mais escapa da aba Promoções.',
       'uma pergunta rápida, {{nome}}',
$html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="padding:8px 24px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#1d2436;">Oi, {{nome}},</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#1d2436;">
          Escreva como se estivesse escrevendo para uma pessoa só. Sem banner, sem
          "prezado cliente". Uma pergunta ou uma observação específica funciona melhor
          do que um anúncio.
        </p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#1d2436;">
          Se quiser mandar para algum lugar, use um <a href="https://exemplo.com.br" style="color:#0147FF;">link no meio do texto</a> — ele é rastreado igual ao botão.
        </p>
        <p style="margin:0 0 6px;font-size:16px;line-height:1.7;color:#1d2436;">Abraço,</p>
        <p style="margin:0 0 28px;font-size:16px;line-height:1.7;color:#1d2436;"><strong>Seu nome</strong></p>
        <hr style="border:none;border-top:1px solid #e4e8f2;margin:0 0 14px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#8d96ad;">{{rodape}}</p>
      </td></tr>
    </table>
  </td></tr>
</table>$html$
where not exists (select 1 from public.email_templates where nome = 'Texto puro (o que mais chega na caixa de entrada)');

-- ═════════════════════════════════════════════════════════════════════════════
-- 0012_eventos_email.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0012_eventos_email.sql
-- Registro de abertura, clique e descadastro — no banco, e não na aplicação.
--
-- Por que é função SQL e não um `select` + `update` no Next: `aberturas = aberturas + 1`
-- feito em duas viagens perde contagem. Uma pessoa que abre o e-mail no celular e no
-- computador ao mesmo tempo (ou o proxy do Gmail buscando a imagem duas vezes) dispara
-- duas requisições simultâneas; as duas leem `aberturas = 3`, as duas gravam 4, e uma
-- abertura some. Dentro de uma função, o `update` é atômico e o número fecha.
--
-- Todas seguem a mesma regra de status: o funil só ANDA PARA A FRENTE. Um clique não
-- volta para "aberto", e uma abertura tardia não desfaz um clique.

-- Ordem do funil de e-mail, para comparar status sem espalhar CASE por toda parte.
create or replace function public.ordem_status_email(p_status text)
returns integer language sql immutable as $$
  select case p_status
    when 'pendente'  then 0
    when 'enviando'  then 1
    when 'enviado'   then 2
    when 'entregue'  then 3
    when 'aberto'    then 4
    when 'clicado'   then 5
    else -1                      -- bounce, spam, falha e cancelado: estados terminais
  end;
$$;

/**
 * Abertura (pixel). Também confirma a ENTREGA: se o e-mail foi aberto, ele chegou —
 * mesmo que o webhook de entrega do provedor não tenha vindo (caso do SMTP puro).
 */
create or replace function public.registrar_abertura(
  p_token text,
  p_user_agent text default null,
  p_ip text default null
) returns boolean language plpgsql as $$
declare
  v_id uuid;
  v_campaign uuid;
  v_status text;
begin
  select id, campaign_id, status into v_id, v_campaign, v_status
    from public.email_recipients where token = p_token;
  -- Token de teste ou inexistente: não é erro, simplesmente não há o que contar.
  if v_id is null then return false; end if;
  -- Bounce/spam/falha não viram "aberto" por um pixel atrasado.
  if public.ordem_status_email(v_status) < 0 then return false; end if;

  update public.email_recipients
     set aberturas = aberturas + 1,
         ultimo_aberto_em = now(),
         primeiro_aberto_em = coalesce(primeiro_aberto_em, now()),
         entregue_em = coalesce(entregue_em, now()),
         status = case when public.ordem_status_email(status) < 4 then 'aberto' else status end
   where id = v_id;

  insert into public.email_events (recipient_id, campaign_id, tipo, user_agent, ip)
    values (v_id, v_campaign, 'aberto', left(p_user_agent, 400), p_ip);
  return true;
end $$;

/**
 * Clique. Implica abertura: muitos clientes bloqueiam imagem por padrão, então existe
 * gente que clica sem nunca ter disparado o pixel. Não contar essa abertura faria a
 * taxa de clique passar da de abertura — um número que denuncia o erro na hora.
 */
create or replace function public.registrar_clique(
  p_token text,
  p_url text,
  p_user_agent text default null,
  p_ip text default null
) returns boolean language plpgsql as $$
declare
  v_id uuid;
  v_campaign uuid;
  v_status text;
begin
  select id, campaign_id, status into v_id, v_campaign, v_status
    from public.email_recipients where token = p_token;
  if v_id is null then return false; end if;
  if public.ordem_status_email(v_status) < 0 then return false; end if;

  update public.email_recipients
     set cliques = cliques + 1,
         primeiro_clique_em = coalesce(primeiro_clique_em, now()),
         primeiro_aberto_em = coalesce(primeiro_aberto_em, now()),
         ultimo_aberto_em = coalesce(ultimo_aberto_em, now()),
         entregue_em = coalesce(entregue_em, now()),
         aberturas = greatest(aberturas, 1),
         status = 'clicado'
   where id = v_id;

  insert into public.email_events (recipient_id, campaign_id, tipo, url, user_agent, ip)
    values (v_id, v_campaign, 'clicado', left(p_url, 1000), left(p_user_agent, 400), p_ip);
  return true;
end $$;

/**
 * Descadastro. Marca o CONTATO, não só este envio: a pessoa saiu da comunicação
 * inteira, não da campanha. É o que faz o próximo fan-out pular esse e-mail.
 */
create or replace function public.registrar_descadastro(p_token text)
returns boolean language plpgsql as $$
declare
  v_id uuid;
  v_campaign uuid;
  v_contact uuid;
begin
  select id, campaign_id, contact_id into v_id, v_campaign, v_contact
    from public.email_recipients where token = p_token;
  if v_id is null then return false; end if;

  if v_contact is not null then
    update public.contacts
       set status_email = 'descadastrado',
           descadastrado_em = coalesce(descadastrado_em, now())
     where id = v_contact;
  end if;

  insert into public.email_events (recipient_id, campaign_id, tipo)
    values (v_id, v_campaign, 'descadastro');
  return true;
end $$;

/**
 * Bounce e marcação de spam, vindos do webhook do provedor.
 *
 * Os dois SEMPRE derrubam o contato: caixa inexistente não volta a existir, e quem
 * apertou "é spam" não quer receber mais nada. Insistir depois disso é o caminho mais
 * curto para o domínio inteiro parar de chegar na caixa de entrada de todo mundo.
 */
create or replace function public.registrar_falha_email(
  p_message_id text,
  p_tipo text,                              -- 'bounce' | 'spam'
  p_detalhe text default null
) returns boolean language plpgsql as $$
declare
  v_id uuid;
  v_campaign uuid;
  v_contact uuid;
begin
  if p_tipo not in ('bounce','spam') then return false; end if;

  select id, campaign_id, contact_id into v_id, v_campaign, v_contact
    from public.email_recipients where provider_message_id = p_message_id;
  if v_id is null then return false; end if;

  update public.email_recipients
     set status = p_tipo, erro = left(p_detalhe, 500)
   where id = v_id;

  if v_contact is not null then
    update public.contacts
       set status_email = p_tipo,
           descadastrado_em = coalesce(descadastrado_em, now())
     where id = v_contact;
  end if;

  insert into public.email_events (recipient_id, campaign_id, tipo, detalhe)
    values (v_id, v_campaign, p_tipo, left(p_detalhe, 500));
  return true;
end $$;

/** Entrega confirmada pelo provedor. Só avança; nunca puxa de "aberto" para "entregue". */
create or replace function public.registrar_entrega_email(p_message_id text)
returns boolean language plpgsql as $$
declare
  v_id uuid;
  v_campaign uuid;
begin
  select id, campaign_id into v_id, v_campaign
    from public.email_recipients where provider_message_id = p_message_id;
  if v_id is null then return false; end if;

  update public.email_recipients
     set entregue_em = coalesce(entregue_em, now()),
         status = case when public.ordem_status_email(status) < 3 then 'entregue' else status end
   where id = v_id;

  insert into public.email_events (recipient_id, campaign_id, tipo)
    values (v_id, v_campaign, 'entregue');
  return true;
end $$;

-- As funções são chamadas exclusivamente pelas rotas do app, que usam a service_role.
-- Sem isto, alguém com a chave pública do Supabase (que vai no navegador, por
-- definição) chamaria `registrar_descadastro` em massa e derrubaria a base inteira.
--
-- O REVOKE precisa ser de PUBLIC, e não de `anon, authenticated`: no Postgres, toda
-- função nasce com EXECUTE concedido a PUBLIC, e `anon`/`authenticated` herdam por
-- esse caminho. Revogar só dos dois nomes deixaria o acesso intacto — o tipo de
-- engano que passa despercebido justamente porque o comando roda sem erro.
revoke execute on function public.registrar_abertura(text, text, text) from public;
revoke execute on function public.registrar_clique(text, text, text, text) from public;
revoke execute on function public.registrar_descadastro(text) from public;
revoke execute on function public.registrar_falha_email(text, text, text) from public;
revoke execute on function public.registrar_entrega_email(text) from public;

-- E devolver explicitamente para quem precisa: depois do REVOKE de PUBLIC, a
-- service_role também ficaria sem EXECUTE.
grant execute on function public.registrar_abertura(text, text, text) to service_role;
grant execute on function public.registrar_clique(text, text, text, text) to service_role;
grant execute on function public.registrar_descadastro(text) to service_role;
grant execute on function public.registrar_falha_email(text, text, text) to service_role;
grant execute on function public.registrar_entrega_email(text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0013_revoga_funcoes_de_anon.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0013_revoga_funcoes_de_anon.sql
-- Correção da 0012, descoberta ao montar o banco real (16/09/2026).
--
-- A 0012 revogou EXECUTE de PUBLIC, o que é certo no Postgres puro. Mas o Supabase
-- concede EXECUTE DIRETAMENTE a `anon` e `authenticated` em toda função nova do schema
-- public (default privileges). Essas concessões não passam por PUBLIC, então sobreviveram:
-- com a chave pública dava para chamar registrar_descadastro/registrar_falha_email.
-- Conferido com has_function_privilege('anon', ...) = true antes desta migration.

revoke execute on function public.registrar_abertura(text, text, text) from anon, authenticated;
revoke execute on function public.registrar_clique(text, text, text, text) from anon, authenticated;
revoke execute on function public.registrar_descadastro(text) from anon, authenticated;
revoke execute on function public.registrar_falha_email(text, text, text) from anon, authenticated;
revoke execute on function public.registrar_entrega_email(text) from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0014_categorias_da_agencia.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0014_categorias_da_agencia.sql
-- As categorias vieram do projeto de origem (inovvatur-flows): AgentePRO, Academy e P360
-- são produtos de outra empresa. Trocadas pelas frentes da "Se Tu For, Eu Vou":
--   lives       — divulgação e lembretes das lives (o antigo "academy": aula ao vivo)
--   expedicoes  — campanhas de uma expedição/turma
--   comunidade  — a mensagem recorrente nas comunidades de WhatsApp (o antigo "p360")
--   avulsas     — o resto
-- As chaves também moram em src/lib/categories.ts; mudar uma exige mudar a outra.

alter table public.campaigns    drop constraint if exists campaigns_categoria_check;
alter table public.sequences    drop constraint if exists sequences_categoria_check;
alter table public.recorrencias drop constraint if exists recorrencias_categoria_check;

update public.campaigns    set categoria = case categoria when 'academy' then 'lives' when 'p360' then 'comunidade' when 'agentepro' then 'avulsas' else categoria end;
update public.sequences    set categoria = case categoria when 'academy' then 'lives' when 'p360' then 'comunidade' when 'agentepro' then 'avulsas' else categoria end;
update public.recorrencias set categoria = case categoria when 'academy' then 'lives' when 'p360' then 'comunidade' when 'agentepro' then 'avulsas' else categoria end;

alter table public.sequences    alter column categoria set default 'lives';
alter table public.recorrencias alter column categoria set default 'comunidade';

alter table public.campaigns add constraint campaigns_categoria_check
  check (categoria in ('lives','expedicoes','comunidade','avulsas'));
alter table public.sequences add constraint sequences_categoria_check
  check (categoria in ('lives','expedicoes','comunidade','avulsas'));
alter table public.recorrencias add constraint recorrencias_categoria_check
  check (categoria in ('lives','expedicoes','comunidade','avulsas'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 0015_identidade_stfv.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0015_identidade_stfv.sql
-- Identidade da Se Tu For, Eu Vou! Viagens nos dados que já vêm prontos.
--
-- Os três modelos da 0011 nasceram com a paleta do projeto de origem (azul #0147FF,
-- "SUA MARCA"). Aqui viram verde-petróleo #09282B, lima #D7F264 e off-white #F8F6F7 —
-- a mesma paleta do portal e das LPs. Botão lima leva texto verde-petróleo (12,4:1).
--
-- Só troca o que ainda está com o valor de fábrica: um modelo que alguém já editou no
-- app não é sobrescrito (o `where html like` casa só o texto original).

update public.email_templates set html = replace(replace(replace(replace(replace(replace(replace(
    html,
    'background:#f4f6fb;', 'background:#F8F6F7;'),
    'background:#0147FF;padding:22px 28px;', 'background:#09282B;padding:22px 28px;'),
    'color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.08em;">SUA MARCA', 'color:#D7F264;font-size:15px;font-weight:700;letter-spacing:.12em;">SE TU FOR, EU VOU! VIAGENS'),
    'color:#0A0F1F;', 'color:#09282B;'),
    'color:#3d4660;', 'color:#3F5E5B;'),
    'background:#0147FF;border-radius:10px;', 'background:#D7F264;border-radius:10px;'),
    'font-weight:600;color:#ffffff;text-decoration:none;">Quero saber mais', 'font-weight:600;color:#09282B;text-decoration:none;">Quero saber mais')
  where nome = 'Anúncio simples' and html like '%SUA MARCA%';

update public.email_templates set html = replace(replace(replace(replace(replace(replace(replace(replace(
    html,
    'background:#f4f6fb;', 'background:#F8F6F7;'),
    'background:#0A0F1F;padding:26px 28px;', 'background:#09282B;padding:26px 28px;'),
    'color:#7fa6ff;', 'color:#D7F264;'),
    'AULA AO VIVO', 'LIVE AO VIVO'),
    'color:#0A0F1F;', 'color:#09282B;'),
    'color:#3d4660;', 'color:#3F5E5B;'),
    'background:#00a37a;border-radius:10px;', 'background:#D7F264;border-radius:10px;'),
    'font-weight:600;color:#ffffff;text-decoration:none;">Entrar na aula', 'font-weight:600;color:#09282B;text-decoration:none;">Entrar na live')
  where nome = 'Convite para evento ou aula' and html like '%#00a37a%';

update public.email_templates
   set nome = 'Convite para live',
       assunto_sugerido = '{{nome}}, sua vaga na live desta semana',
       descricao = 'Data, hora e link em destaque. Feito para a pessoa entender em 3 segundos quando é a live e onde entra.'
 where nome = 'Convite para evento ou aula';

update public.email_templates set html = replace(replace(replace(
    html,
    'color:#0147FF;', 'color:#09282B;font-weight:600;'),
    'color:#1d2436;', 'color:#09282B;'),
    '<strong>Seu nome</strong>', '<strong>Equipe Se Tu For, Eu Vou!</strong>')
  where nome = 'Texto puro (o que mais chega na caixa de entrada)' and html like '%#0147FF%';

-- Remetente padrão: nome e rodapé com os dados cadastrais oficiais (CNPJ e endereço
-- aparecem no rodapé de todo e-mail — é exigência de entregabilidade e da LGPD mostrar
-- quem manda). O endereço de e-mail fica vazio até o domínio ser verificado no Resend.
update public.app_settings
   set valor = valor
     || jsonb_build_object('nome', 'Se Tu For, Eu Vou! Viagens')
     || jsonb_build_object('rodape_endereco', 'Se Tu For, Eu Vou! Viagens · CNPJ 53.545.815/0001-12 · Av. Dr. Chucri Zaidan, 1550 — Morumbi, São Paulo — SP, 04711-130')
 where chave = 'email_remetente'
   and coalesce(valor->>'nome', '') = ''
   and coalesce(valor->>'rodape_endereco', '') = '';

-- ═════════════════════════════════════════════════════════════════════════════
-- 0016_cadencias.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0017_enquete.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0017_enquete.sql
-- Enquete do WhatsApp como tipo de campanha.
--
-- A pergunta mora em `mensagem` (é o texto que aparece em cima das opções), e as opções
-- em `enquete_opcoes`, na ordem em que aparecem. `enquete_multipla` = a pessoa pode
-- marcar mais de uma (no WhatsApp, "Permitir várias respostas").
--
-- O WhatsApp aceita de 2 a 12 opções; a regra fica também no banco para uma campanha
-- inválida nunca chegar ao motor e falhar só na hora de sair.

alter table public.campaigns drop constraint if exists campaigns_tipo_check;
alter table public.campaigns add constraint campaigns_tipo_check
  check (tipo in ('texto','imagem','video','pdf','enquete'));

alter table public.campaigns add column if not exists enquete_opcoes text[];
alter table public.campaigns add column if not exists enquete_multipla boolean not null default false;

alter table public.campaigns drop constraint if exists campaigns_enquete_opcoes_check;
alter table public.campaigns add constraint campaigns_enquete_opcoes_check
  check (tipo <> 'enquete' or coalesce(array_length(enquete_opcoes, 1), 0) between 2 and 12);

-- ═════════════════════════════════════════════════════════════════════════════
-- 0018_tags_de_grupo.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0019_api_oficial_whatsapp.sql
-- ═════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════
-- 0020_automacoes.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- supabase/migrations/0020_automacoes.sql
-- Automações no estilo ManyChat, só para a API oficial do WhatsApp (Cloud API).
--
-- Até a 0019 o SendFlow só EMPURRAVA mensagem: campanha sai, recibo volta, fim. O que
-- o ManyChat faz — e o que esta migration traz — é CONVERSAR: a pessoa escreve
-- "japão", o sistema responde com botões, guarda a escolha num campo, põe uma tag,
-- espera dois dias e manda o próximo passo. Para isso o banco precisa de quatro coisas
-- que não existiam:
--
--   1. a CONVERSA como entidade (wa_conversas + wa_mensagens): sem ela não há janela
--      de 24 h, não há caixa de entrada e não há "pausar o robô para um humano";
--   2. o FLUXO (fluxos): um grafo de nós desenhado na tela, guardado inteiro em jsonb;
--   3. o GATILHO (fluxo_gatilhos): o que faz um fluxo começar — palavra-chave, primeira
--      mensagem, link de referência, anúncio de clique para o WhatsApp…;
--   4. a EXECUÇÃO (fluxo_execucoes): onde cada pessoa está dentro de cada fluxo. É ela
--      que aguenta "espere 2 dias" e "espere a resposta" sem nenhum processo parado
--      esperando — o estado está na linha, e o tick acorda quem chegou a hora.
--
-- E, junto, a conexão pelo botão da Meta (Cadastro Incorporado, igual ao QS): o token
-- de cada número vai para o Vault, criptografado. A tabela guarda só o id do segredo.

-- ── 1. A conexão pelo botão da Meta ──────────────────────────────────────────────

-- Id do segredo no Vault com o token DESTE número. Nulo = usa META_ACCESS_TOKEN do
-- ambiente (o jeito antigo, que continua valendo para quem cadastrou à mão).
alter table public.connections add column if not exists segredo_id uuid;
-- 'cloud' = número só na API; 'coexistencia' = WhatsApp Business do celular + API.
alter table public.connections add column if not exists modo_meta text;
alter table public.connections drop constraint if exists connections_modo_meta_check;
alter table public.connections add constraint connections_modo_meta_check
  check (modo_meta is null or modo_meta in ('cloud', 'coexistencia'));
-- Quando o webhook DESTE número foi apontado para o SendFlow (override por número).
alter table public.connections add column if not exists webhook_apontado_em timestamptz;
-- Última mensagem de cliente que entrou por este número: é a prova de que a volta
-- funciona. Sem ela, "ninguém respondeu" e "o webhook morreu" parecem a mesma coisa.
alter table public.connections add column if not exists ultima_entrada_em timestamptz;

create or replace function public.sf_meta_guardar_token(p_conexao uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
  v_nome text := 'sendflow_meta_' || p_conexao::text;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'token inválido';
  end if;
  select id into v_seg from vault.secrets where name = v_nome;
  if v_seg is null then
    v_seg := vault.create_secret(p_token, v_nome, 'Token da Cloud API (SendFlow) da conexão ' || p_conexao::text);
  else
    perform vault.update_secret(v_seg, p_token, v_nome);
  end if;
  update public.connections set segredo_id = v_seg where id = p_conexao;
  return v_seg;
end;
$fn$;

create or replace function public.sf_meta_token(p_phone text)
returns text
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $fn$
  select d.decrypted_secret
    from public.connections c
    join vault.decrypted_secrets d on d.id = c.segredo_id
   where c.phone_number_id = p_phone
   limit 1;
$fn$;

create or replace function public.sf_meta_apagar_token(p_conexao uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
begin
  select segredo_id into v_seg from public.connections where id = p_conexao;
  if v_seg is not null then
    delete from vault.secrets where id = v_seg;
    update public.connections set segredo_id = null where id = p_conexao;
  end if;
end;
$fn$;

-- ── 2. Campos personalizados (os "User Fields" do ManyChat) ──────────────────────
--
-- O VALOR já tinha casa: `contacts.campos` (jsonb, desde a 0007). Faltava a DEFINIÇÃO
-- — o tipo, o rótulo bonito — para a tela oferecer uma lista em vez de um campo de
-- texto livre onde "cidade", "Cidade" e "cidade " viram três campos diferentes.

create table if not exists public.contact_fields (
  id uuid primary key default gen_random_uuid(),
  -- A chave usada em {{chave}} e em contacts.campos. Minúsculas, número e _.
  chave text not null check (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  rotulo text not null,
  tipo text not null default 'texto'
    check (tipo in ('texto', 'numero', 'data', 'sim_nao', 'email', 'telefone')),
  descricao text,
  criado_em timestamptz not null default now()
);
create unique index if not exists contact_fields_chave_uidx on public.contact_fields (chave);
alter table public.contact_fields enable row level security;

-- ── 3. A conversa ────────────────────────────────────────────────────────────────

create table if not exists public.wa_conversas (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  -- O `wa_id` exatamente como a Meta manda. É para ELE que se responde: no Brasil a
  -- Meta às vezes conhece o número SEM o nono dígito, e responder para o número
  -- "consertado" cai em outra pessoa ou em lugar nenhum.
  wa_id text not null,
  nome_perfil text,
  -- A janela de 24 h conta da ÚLTIMA mensagem da pessoa, não da nossa.
  ultima_entrada_em timestamptz,
  ultima_mensagem_em timestamptz,
  ultima_previa text,
  nao_lidas integer not null default 0,
  -- "Pausar automação": enquanto no futuro, nenhum fluxo responde esta pessoa. É o
  -- botão que o atendente aperta ao assumir a conversa, igual ao Live Chat do ManyChat.
  automacao_pausada_ate timestamptz,
  status text not null default 'aberta' check (status in ('aberta', 'fechada')),
  -- Trava curta contra duas mensagens seguidas disparando o mesmo fluxo duas vezes.
  processando_ate timestamptz,
  -- Resposta padrão: quando foi a última, para respeitar "no máximo 1x a cada N horas".
  resposta_padrao_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists wa_conversas_uidx on public.wa_conversas (connection_id, wa_id);
create index if not exists wa_conversas_recentes_idx on public.wa_conversas (ultima_mensagem_em desc nulls last);
create index if not exists wa_conversas_contato_idx on public.wa_conversas (contact_id);

drop trigger if exists trg_wa_conversas_touch on public.wa_conversas;
create trigger trg_wa_conversas_touch before update on public.wa_conversas
for each row execute function public.touch_atualizado_em();
alter table public.wa_conversas enable row level security;

create table if not exists public.wa_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.wa_conversas(id) on delete cascade,
  direcao text not null check (direcao in ('in', 'out')),
  -- texto | imagem | video | audio | documento | figurinha | botoes | lista | link |
  -- template | resposta_botao | resposta_lista | localizacao | contato | reacao | outro
  tipo text not null default 'texto',
  texto text,
  -- O corpo completo (botões, mídia, id do botão clicado…). A tela desenha a partir dele.
  payload jsonb,
  wamid text,
  status text check (status is null or status in ('enviado', 'entregue', 'lido', 'falha')),
  erro text,
  -- Quem produziu a mensagem que saiu: um fluxo, um atendente, uma campanha.
  origem text check (origem is null or origem in ('fluxo', 'manual', 'campanha', 'teste')),
  fluxo_id uuid,
  no_id text,
  criado_em timestamptz not null default now()
);

create unique index if not exists wa_mensagens_wamid_uidx on public.wa_mensagens (wamid) where wamid is not null;
create index if not exists wa_mensagens_conversa_idx on public.wa_mensagens (conversa_id, criado_em desc);
alter table public.wa_mensagens enable row level security;

-- ── 4. O fluxo ───────────────────────────────────────────────────────────────────

create table if not exists public.fluxos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  -- Nulo = responde por qualquer número oficial conectado.
  connection_id uuid references public.connections(id) on delete set null,
  status text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'pausado')),
  -- {"nos":[{"id","tipo","x","y","dados"}], "ligacoes":[{"id","de","saida","para"}]}
  grafo jsonb not null default '{"nos":[],"ligacoes":[]}'::jsonb,
  pasta text,
  execucoes_total integer not null default 0,
  concluidas_total integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
drop trigger if exists trg_fluxos_touch on public.fluxos;
create trigger trg_fluxos_touch before update on public.fluxos
for each row execute function public.touch_atualizado_em();
alter table public.fluxos enable row level security;

create table if not exists public.fluxo_gatilhos (
  id uuid primary key default gen_random_uuid(),
  fluxo_id uuid not null references public.fluxos(id) on delete cascade,
  tipo text not null check (tipo in (
    'palavra_chave',  -- a pessoa escreveu (ou clicou num botão com) tal palavra
    'boas_vindas',    -- a PRIMEIRA mensagem que esta pessoa manda para o número
    'padrao',         -- nada mais casou: a "resposta padrão"
    'link_ref',       -- chegou pelo link wa.me com o código de referência
    'anuncio',        -- chegou por anúncio de clique para o WhatsApp
    'tag_adicionada', -- alguém/algo pôs esta tag no contato
    'webhook'         -- sistema de fora (formulário da LP, n8n) pediu para iniciar
  )),
  -- palavra_chave: {"palavras":["japão","japao"],"modo":"contem|exata|comeca"}
  -- link_ref:      {"codigo":"live-peru","texto":"Quero saber da live do Peru"}
  -- anuncio:       {"ad_ids":["1202…"]}  (vazio = qualquer anúncio)
  -- tag_adicionada:{"tag":"quente"}
  -- padrao:        {"intervalo_horas":24}
  -- webhook:       {"token":"…"}
  config jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  -- Maior primeiro. Empate: o mais antigo.
  prioridade smallint not null default 0,
  disparos integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists fluxo_gatilhos_tipo_idx on public.fluxo_gatilhos (tipo) where ativo;
create index if not exists fluxo_gatilhos_fluxo_idx on public.fluxo_gatilhos (fluxo_id);
-- Um código de link de referência aponta para UM fluxo só.
create unique index if not exists fluxo_gatilhos_ref_uidx
  on public.fluxo_gatilhos ((lower(config ->> 'codigo'))) where tipo = 'link_ref';
alter table public.fluxo_gatilhos enable row level security;

-- ── 5. A execução: onde cada pessoa está em cada fluxo ───────────────────────────

create table if not exists public.fluxo_execucoes (
  id uuid primary key default gen_random_uuid(),
  fluxo_id uuid not null references public.fluxos(id) on delete cascade,
  conversa_id uuid not null references public.wa_conversas(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  gatilho_id uuid references public.fluxo_gatilhos(id) on delete set null,
  no_atual text,
  estado text not null default 'rodando' check (estado in (
    'rodando', 'aguardando_resposta', 'aguardando_tempo', 'concluida', 'cancelada', 'erro'
  )),
  -- Quando o tick deve mexer nesta execução: fim do "aguarde", ou o prazo da pergunta.
  acordar_em timestamptz,
  -- O que o nó parado espera: {"tipo":"botoes","saidas":{"id_do_botao":"b1"}} ou
  -- {"tipo":"pergunta","tentativas":1}.
  aguardando jsonb,
  -- Contador anti-laço: um fluxo que volta para si mesmo não pode rodar para sempre.
  passos integer not null default 0,
  erro text,
  -- Trava do tick: duas execuções simultâneas do motor não pegam a mesma linha.
  travada_ate timestamptz,
  iniciada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  concluida_em timestamptz
);
create index if not exists fluxo_execucoes_acordar_idx
  on public.fluxo_execucoes (acordar_em) where estado in ('aguardando_tempo', 'aguardando_resposta');
create index if not exists fluxo_execucoes_conversa_idx
  on public.fluxo_execucoes (conversa_id) where estado in ('rodando', 'aguardando_resposta', 'aguardando_tempo');
create index if not exists fluxo_execucoes_fluxo_idx on public.fluxo_execucoes (fluxo_id, iniciada_em desc);
alter table public.fluxo_execucoes enable row level security;

-- Cada passo que importa, para os números que aparecem EM CIMA de cada nó no editor
-- (quantos entraram, quantos clicaram em cada botão). Tabela estreita e só-inserção.
create table if not exists public.fluxo_eventos (
  id bigserial primary key,
  fluxo_id uuid not null references public.fluxos(id) on delete cascade,
  execucao_id uuid references public.fluxo_execucoes(id) on delete cascade,
  no_id text not null,
  -- entrou | enviou | saida | erro
  tipo text not null,
  saida text,
  detalhe text,
  criado_em timestamptz not null default now()
);
create index if not exists fluxo_eventos_fluxo_idx on public.fluxo_eventos (fluxo_id, no_id, tipo);
alter table public.fluxo_eventos enable row level security;

-- Contagem por nó sem trazer as linhas para a aplicação.
create or replace function public.sf_estatisticas_fluxo(p_fluxo uuid)
returns table (no_id text, tipo text, saida text, total bigint)
language sql
security definer
stable
set search_path = public
as $fn$
  select e.no_id, e.tipo, coalesce(e.saida, ''), count(*)
    from public.fluxo_eventos e
   where e.fluxo_id = p_fluxo
   group by 1, 2, 3;
$fn$;

-- ── 6. Travas atômicas ───────────────────────────────────────────────────────────

-- Toma a conversa por alguns segundos. Devolve false se outra requisição já está
-- tratando esta pessoa — duas mensagens em sequência ("oi" + "japão") não podem abrir
-- dois fluxos de boas-vindas.
create or replace function public.sf_tomar_conversa(p_conversa uuid, p_segundos int default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  ok boolean;
begin
  update public.wa_conversas
     set processando_ate = now() + make_interval(secs => greatest(1, least(p_segundos, 120)))
   where id = p_conversa
     and (processando_ate is null or processando_ate < now())
  returning true into ok;
  return coalesce(ok, false);
end;
$fn$;

create or replace function public.sf_soltar_conversa(p_conversa uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.wa_conversas set processando_ate = null where id = p_conversa;
$fn$;

-- O tick pega as execuções vencidas e já as trava, com `skip locked` para dois ticks
-- simultâneos levarem lotes diferentes.
create or replace function public.sf_reivindicar_execucoes(p_limite int)
returns setof public.fluxo_execucoes
language sql
security definer
set search_path = public
as $fn$
  update public.fluxo_execucoes x
     set travada_ate = now() + interval '2 minutes'
   where x.id in (
     select e.id
       from public.fluxo_execucoes e
      where e.estado in ('aguardando_tempo', 'aguardando_resposta')
        and e.acordar_em is not null
        and e.acordar_em <= now()
        and (e.travada_ate is null or e.travada_ate < now())
      order by e.acordar_em
      limit greatest(1, least(p_limite, 200))
      for update skip locked
   )
  returning x.*;
$fn$;

-- Conta um disparo no gatilho e uma execução no fluxo, sem ler-somar-gravar na
-- aplicação (que perde contagem quando dois chegam juntos).
create or replace function public.sf_contar_disparo(p_gatilho uuid, p_fluxo uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.fluxo_gatilhos set disparos = disparos + 1 where id = p_gatilho;
  update public.fluxos set execucoes_total = execucoes_total + 1 where id = p_fluxo;
$fn$;

-- ── 7. Só o servidor chama (ver 0013: tirar de public NÃO basta no Supabase) ─────

revoke all on function public.sf_meta_guardar_token(uuid, text) from public;
revoke all on function public.sf_meta_guardar_token(uuid, text) from anon, authenticated;
grant execute on function public.sf_meta_guardar_token(uuid, text) to service_role;

revoke all on function public.sf_meta_token(text) from public;
revoke all on function public.sf_meta_token(text) from anon, authenticated;
grant execute on function public.sf_meta_token(text) to service_role;

revoke all on function public.sf_meta_apagar_token(uuid) from public;
revoke all on function public.sf_meta_apagar_token(uuid) from anon, authenticated;
grant execute on function public.sf_meta_apagar_token(uuid) to service_role;

revoke all on function public.sf_estatisticas_fluxo(uuid) from public;
revoke all on function public.sf_estatisticas_fluxo(uuid) from anon, authenticated;
grant execute on function public.sf_estatisticas_fluxo(uuid) to service_role;

revoke all on function public.sf_tomar_conversa(uuid, int) from public;
revoke all on function public.sf_tomar_conversa(uuid, int) from anon, authenticated;
grant execute on function public.sf_tomar_conversa(uuid, int) to service_role;

revoke all on function public.sf_soltar_conversa(uuid) from public;
revoke all on function public.sf_soltar_conversa(uuid) from anon, authenticated;
grant execute on function public.sf_soltar_conversa(uuid) to service_role;

revoke all on function public.sf_reivindicar_execucoes(int) from public;
revoke all on function public.sf_reivindicar_execucoes(int) from anon, authenticated;
grant execute on function public.sf_reivindicar_execucoes(int) to service_role;

revoke all on function public.sf_contar_disparo(uuid, uuid) from public;
revoke all on function public.sf_contar_disparo(uuid, uuid) from anon, authenticated;
grant execute on function public.sf_contar_disparo(uuid, uuid) to service_role;

-- ── 8. Configuração do botão "Conectar com a Meta" ───────────────────────────────
-- config_id do Cadastro Incorporado (Login do Facebook para Empresas). Não é segredo:
-- vai para o navegador de qualquer jeito.
insert into public.app_settings (chave, valor)
values ('meta_cadastro', '{"config_id": null}'::jsonb)
on conflict (chave) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0021_config_meta_no_app.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0021 — Os dados do app da Meta moram no SendFlow, não na Vercel (24/09/2026).
--
-- Até a 0020, App ID, segredo do app e verify token do webhook só existiam como
-- variáveis de ambiente — e conectar um número exigia alguém mexer no painel da Vercel
-- e fazer redeploy. Agora a tela de Conexões guarda os três:
--
--   • App ID e verify token → `app_settings.meta_cadastro` (nenhum dos dois abre nada
--     sozinho; o verify token é gerado pelo próprio SendFlow);
--   • segredo do app        → Vault, pelas funções abaixo. Ele assina o webhook e troca
--     código por token: vazou, qualquer um forja mensagem recebida.
--
-- As variáveis de ambiente continuam valendo como reserva (quem já configurou não perde nada).
--
-- As funções aceitam só nomes da lista — não viram um "leia qualquer segredo do Vault".
-- E, como na 0013, revogar exige `from public` E `from anon, authenticated`.

create or replace function public.sf_cfg_guardar_segredo(p_nome text, p_valor text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
  v_nome text := 'sendflow_cfg_' || p_nome;
begin
  if p_nome is null or p_nome not in ('meta_app_secret') then
    raise exception 'segredo desconhecido: %', p_nome;
  end if;
  if p_valor is null or length(p_valor) < 16 then
    raise exception 'valor inválido';
  end if;
  select id into v_seg from vault.secrets where name = v_nome;
  if v_seg is null then
    perform vault.create_secret(p_valor, v_nome, 'Configuração do SendFlow: ' || p_nome);
  else
    perform vault.update_secret(v_seg, p_valor, v_nome);
  end if;
end;
$fn$;

create or replace function public.sf_cfg_segredo(p_nome text)
returns text
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $fn$
  select d.decrypted_secret
    from vault.decrypted_secrets d
   where p_nome in ('meta_app_secret')
     and d.name = 'sendflow_cfg_' || p_nome
   limit 1;
$fn$;

revoke all on function public.sf_cfg_guardar_segredo(text, text) from public;
revoke all on function public.sf_cfg_guardar_segredo(text, text) from anon, authenticated;
grant execute on function public.sf_cfg_guardar_segredo(text, text) to service_role;

revoke all on function public.sf_cfg_segredo(text) from public;
revoke all on function public.sf_cfg_segredo(text) from anon, authenticated;
grant execute on function public.sf_cfg_segredo(text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0022_resend_no_app.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0022 — A conexão do Resend também mora no SendFlow (24/09/2026).
--
-- Mesmo caminho da 0021: a chave da API do Resend e o segredo do webhook dele vão para
-- o Vault pela tela E-mail → Conexão, sem variável na Vercel. As funções da 0021 só
-- ganham nomes na lista — continuam não sendo um "leia qualquer segredo".
-- `sf_cfg_apagar_segredo` existe para o botão "Desconectar".

create or replace function public.sf_cfg_guardar_segredo(p_nome text, p_valor text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
  v_nome text := 'sendflow_cfg_' || p_nome;
begin
  if p_nome is null or p_nome not in ('meta_app_secret', 'resend_api_key', 'resend_webhook_secret') then
    raise exception 'segredo desconhecido: %', p_nome;
  end if;
  if p_valor is null or length(p_valor) < 16 then
    raise exception 'valor inválido';
  end if;
  select id into v_seg from vault.secrets where name = v_nome;
  if v_seg is null then
    perform vault.create_secret(p_valor, v_nome, 'Configuração do SendFlow: ' || p_nome);
  else
    perform vault.update_secret(v_seg, p_valor, v_nome);
  end if;
end;
$fn$;

create or replace function public.sf_cfg_segredo(p_nome text)
returns text
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $fn$
  select d.decrypted_secret
    from vault.decrypted_secrets d
   where p_nome in ('meta_app_secret', 'resend_api_key', 'resend_webhook_secret')
     and d.name = 'sendflow_cfg_' || p_nome
   limit 1;
$fn$;

create or replace function public.sf_cfg_apagar_segredo(p_nome text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
begin
  if p_nome is null or p_nome not in ('meta_app_secret', 'resend_api_key', 'resend_webhook_secret') then
    raise exception 'segredo desconhecido: %', p_nome;
  end if;
  delete from vault.secrets where name = 'sendflow_cfg_' || p_nome;
end;
$fn$;

revoke all on function public.sf_cfg_guardar_segredo(text, text) from public;
revoke all on function public.sf_cfg_guardar_segredo(text, text) from anon, authenticated;
grant execute on function public.sf_cfg_guardar_segredo(text, text) to service_role;

revoke all on function public.sf_cfg_segredo(text) from public;
revoke all on function public.sf_cfg_segredo(text) from anon, authenticated;
grant execute on function public.sf_cfg_segredo(text) to service_role;

revoke all on function public.sf_cfg_apagar_segredo(text) from public;
revoke all on function public.sf_cfg_apagar_segredo(text) from anon, authenticated;
grant execute on function public.sf_cfg_apagar_segredo(text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0023_contatos_crm.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0023 — Contatos no nível de um CRM de e-mail (24/09/2026).
--
-- O módulo E-mail vai ter as funções do ActiveCampaign nativas. Todas elas se apoiam
-- em quatro peças que faltavam na base de contatos:
--
--   1. contact_eventos — a LINHA DO TEMPO do contato. Quem escreve é o BANCO (gatilhos),
--      não a tela: tag posta pelo CSV, pela automação ou à mão entra igual. É também o
--      que as automações de e-mail (fase 2.4) vão escutar.
--   2. score — pontuação por engajamento, com pesos em app_settings.score e janela de
--      dias (o que foi feito há um ano não vale como o que foi feito ontem).
--   3. segments — filtros SALVOS, resolvidos inteiros no banco por sf_filtrar_contatos.
--      Filtrar no servidor com listas de ids batia no teto de 1000 do PostgREST
--      (ver postgrest-teto-1000) — a lista com 1.500 membros mostrava 1.000, calada.
--   4. funções de tag — contar, renomear e apagar em toda a base de uma vez.
--
-- O SQL dinâmico dos segmentos só usa format() com %L (valor) e %I (coluna de uma
-- lista fechada). Nenhuma função aqui é executável por anon/authenticated (ver 0013).

-- ── 1. Linha do tempo ────────────────────────────────────────────────────────────

create table if not exists public.contact_eventos (
  id bigserial primary key,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  tipo text not null,
  detalhe jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  constraint contact_eventos_tipo_check check (tipo in (
    'criado', 'tag_adicionada', 'tag_removida', 'entrou_lista', 'saiu_lista',
    'email_aberto', 'email_clicado', 'descadastrou_email', 'bounce', 'spam',
    'reinscreveu_email', 'formulario', 'nota'
  ))
);
create index if not exists contact_eventos_contato_idx on public.contact_eventos (contact_id, criado_em desc);
create index if not exists contact_eventos_tipo_idx on public.contact_eventos (tipo, criado_em desc);
alter table public.contact_eventos enable row level security;

create or replace function public.sf_evento_contato()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  t text;
begin
  if tg_table_name = 'contacts' then
    if tg_op = 'INSERT' then
      insert into public.contact_eventos (contact_id, tipo, detalhe)
        values (new.id, 'criado', jsonb_build_object('origem', new.origem));
      foreach t in array coalesce(new.tags, '{}'::text[]) loop
        insert into public.contact_eventos (contact_id, tipo, detalhe) values (new.id, 'tag_adicionada', jsonb_build_object('tag', t));
      end loop;
      return new;
    end if;
    -- UPDATE: só o que mudou.
    for t in select unnest(coalesce(new.tags, '{}'::text[])) except select unnest(coalesce(old.tags, '{}'::text[])) loop
      insert into public.contact_eventos (contact_id, tipo, detalhe) values (new.id, 'tag_adicionada', jsonb_build_object('tag', t));
    end loop;
    for t in select unnest(coalesce(old.tags, '{}'::text[])) except select unnest(coalesce(new.tags, '{}'::text[])) loop
      insert into public.contact_eventos (contact_id, tipo, detalhe) values (new.id, 'tag_removida', jsonb_build_object('tag', t));
    end loop;
    if new.status_email is distinct from old.status_email then
      insert into public.contact_eventos (contact_id, tipo, detalhe)
        values (new.id,
                case new.status_email
                  when 'descadastrado' then 'descadastrou_email'
                  when 'bounce' then 'bounce'
                  when 'spam' then 'spam'
                  else 'reinscreveu_email'
                end,
                jsonb_build_object('de', old.status_email, 'para', new.status_email));
    end if;
    return new;
  end if;

  if tg_table_name = 'list_members' then
    if tg_op = 'INSERT' then
      insert into public.contact_eventos (contact_id, tipo, detalhe)
        values (new.contact_id, 'entrou_lista', jsonb_build_object('list_id', new.list_id));
      return new;
    end if;
    -- A lista pode estar sendo apagada junto com o contato (cascata): sem contato, sem evento.
    if exists (select 1 from public.contacts where id = old.contact_id) then
      insert into public.contact_eventos (contact_id, tipo, detalhe)
        values (old.contact_id, 'saiu_lista', jsonb_build_object('list_id', old.list_id));
    end if;
    return old;
  end if;

  if tg_table_name = 'email_events' then
    if new.tipo not in ('aberto', 'clicado') then return new; end if;
    declare
      v_contato uuid;
    begin
      select contact_id into v_contato from public.email_recipients where id = new.recipient_id;
      if v_contato is null then return new; end if;
      if new.tipo = 'aberto' then
        -- Abertura conta UMA vez por e-mail: o pixel dispara a cada vez que a pessoa
        -- reabre, e 12 aberturas do mesmo e-mail não são 12 sinais de interesse.
        if exists (select 1 from public.contact_eventos
                    where contact_id = v_contato and tipo = 'email_aberto'
                      and detalhe->>'recipient_id' = new.recipient_id::text) then
          return new;
        end if;
        insert into public.contact_eventos (contact_id, tipo, detalhe)
          values (v_contato, 'email_aberto', jsonb_build_object('campaign_id', new.campaign_id, 'recipient_id', new.recipient_id));
      else
        insert into public.contact_eventos (contact_id, tipo, detalhe)
          values (v_contato, 'email_clicado', jsonb_build_object('campaign_id', new.campaign_id, 'recipient_id', new.recipient_id, 'url', new.url));
      end if;
    end;
    return new;
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_contacts_eventos on public.contacts;
create trigger trg_contacts_eventos
  after insert or update of tags, status_email on public.contacts
  for each row execute function public.sf_evento_contato();

drop trigger if exists trg_list_members_eventos on public.list_members;
create trigger trg_list_members_eventos
  after insert or delete on public.list_members
  for each row execute function public.sf_evento_contato();

drop trigger if exists trg_email_events_contato on public.email_events;
create trigger trg_email_events_contato
  after insert on public.email_events
  for each row execute function public.sf_evento_contato();

-- ── 2. Pontuação ─────────────────────────────────────────────────────────────────

alter table public.contacts add column if not exists score integer not null default 0;
create index if not exists contacts_score_idx on public.contacts (score desc);

insert into public.app_settings (chave, valor)
values ('score', '{"email_aberto": 1, "email_clicado": 3, "formulario": 10, "tag_adicionada": 0, "janela_dias": 90}'::jsonb)
on conflict (chave) do nothing;

-- Recalcula um contato (ou todos, com null). Barato: índice por contato + janela.
create or replace function public.sf_recalcular_score(p_contact uuid default null)
returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_cfg jsonb;
  v_janela int;
  v_n integer;
begin
  select valor into v_cfg from public.app_settings where chave = 'score';
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_janela := greatest(1, coalesce((v_cfg->>'janela_dias')::int, 90));

  with pontos as (
    select e.contact_id,
           sum(coalesce((v_cfg->>e.tipo)::int, 0)) as total
      from public.contact_eventos e
     where e.criado_em >= now() - make_interval(days => v_janela)
       and (p_contact is null or e.contact_id = p_contact)
     group by e.contact_id
  )
  update public.contacts c
     set score = greatest(0, coalesce(p.total, 0))
    from (select id from public.contacts where p_contact is null or id = p_contact) alvo
    left join pontos p on p.contact_id = alvo.id
   where c.id = alvo.id
     and c.score is distinct from greatest(0, coalesce(p.total, 0));
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.sf_score_no_evento()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_peso int;
begin
  -- Peso zero não mexe na nota: pula o recálculo (importar 10 mil contatos com tag
  -- dispararia 10 mil recálculos à toa).
  select coalesce((valor->>new.tipo)::int, 0) into v_peso from public.app_settings where chave = 'score';
  if coalesce(v_peso, 0) <> 0 then
    perform public.sf_recalcular_score(new.contact_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_contact_eventos_score on public.contact_eventos;
create trigger trg_contact_eventos_score
  after insert on public.contact_eventos
  for each row execute function public.sf_score_no_evento();

-- ── 3. Segmentos ─────────────────────────────────────────────────────────────────

create table if not exists public.segments (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  regras jsonb not null default '{"combinar": "todas", "condicoes": []}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.segments enable row level security;

alter table public.email_campaigns
  add column if not exists segment_id uuid references public.segments (id) on delete set null;

-- Uma condição → um pedaço de WHERE sobre `contacts c`. Lança em condição desconhecida:
-- um filtro que o banco não entendeu NUNCA pode virar "todo mundo".
create or replace function public.sf_condicao_sql(c jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  campo text := c->>'campo';
  op text := c->>'op';
  v text := c->>'valor';
  col text;
  coluna_email text;
  n int;
begin
  -- Grupo dentro de grupo: "(lista X) E (tag A OU tag B)". A tela ainda monta um nível
  -- só; o servidor usa o aninhado para somar filtros rápidos a um segmento "qualquer".
  if c ? 'condicoes' then return public.sf_where_regras(c); end if;
  if campo = 'tag' then
    if op = 'tem' then return format('c.tags @> array[%L]::text[]', v); end if;
    if op = 'nao_tem' then return format('not (coalesce(c.tags, ''{}'') @> array[%L]::text[])', v); end if;
  elsif campo = 'lista' then
    if op = 'esta' then
      return format('exists (select 1 from public.list_members m where m.contact_id = c.id and m.list_id = %L::uuid)', v);
    end if;
    if op = 'nao_esta' then
      return format('not exists (select 1 from public.list_members m where m.contact_id = c.id and m.list_id = %L::uuid)', v);
    end if;
  elsif campo in ('nome', 'email', 'telefone', 'empresa', 'origem', 'status_email', 'status_whatsapp', 'campo') then
    col := case when campo = 'campo' then format('(c.campos->>%L)', c->>'chave') else format('c.%I', campo) end;
    if op = 'igual' then return format('lower(%s) = lower(%L)', col, v); end if;
    if op = 'diferente' then return format('coalesce(lower(%s), '''') <> lower(%L)', col, v); end if;
    if op = 'contem' then return format('%s ilike %L', col, '%' || replace(replace(v, '%', '\%'), '_', '\_') || '%'); end if;
    if op = 'nao_contem' then return format('coalesce(%s, '''') not ilike %L', col, '%' || replace(replace(v, '%', '\%'), '_', '\_') || '%'); end if;
    if op = 'vazio' then return format('coalesce(%s, '''') = ''''', col); end if;
    if op = 'preenchido' then return format('coalesce(%s, '''') <> ''''', col); end if;
    if op in ('maior', 'menor') then
      if v !~ '^-?\d+(\.\d+)?$' then raise exception 'valor numérico inválido: %', v; end if;
      return format('(case when %1$s ~ ''^-?\d+(\.\d+)?$'' then (%1$s)::numeric end) %2$s %3$s::numeric',
                    col, case when op = 'maior' then '>' else '<' end, quote_literal(v));
    end if;
  elsif campo = 'criado' then
    n := v::int;
    if op = 'ultimos_dias' then return format('c.criado_em >= now() - make_interval(days => %s)', n); end if;
    if op = 'mais_de_dias' then return format('c.criado_em < now() - make_interval(days => %s)', n); end if;
  elsif campo in ('abriu_email', 'clicou_email') then
    coluna_email := case when campo = 'abriu_email' then 'primeiro_aberto_em' else 'primeiro_clique_em' end;
    if op = 'ultimos_dias' then
      n := v::int;
      return format('exists (select 1 from public.email_recipients r where r.contact_id = c.id and r.%I >= now() - make_interval(days => %s))', coluna_email, n);
    end if;
    if op = 'nao_ultimos_dias' then
      n := v::int;
      return format('not exists (select 1 from public.email_recipients r where r.contact_id = c.id and r.%I >= now() - make_interval(days => %s))', coluna_email, n);
    end if;
    if op = 'nunca' then
      return format('not exists (select 1 from public.email_recipients r where r.contact_id = c.id and r.%I is not null)', coluna_email);
    end if;
    if op = 'campanha' then
      return format('exists (select 1 from public.email_recipients r where r.contact_id = c.id and r.campaign_id = %L::uuid and r.%I is not null)', v, coluna_email);
    end if;
    if op = 'nao_campanha' then
      -- Recebeu a campanha e NÃO abriu/clicou — o "reenviar para quem não abriu".
      return format('exists (select 1 from public.email_recipients r where r.contact_id = c.id and r.campaign_id = %L::uuid and r.%I is null and r.status not in (''pendente'', ''falha''))', v, coluna_email);
    end if;
  elsif campo = 'score' then
    n := v::int;
    if op = 'maior_igual' then return format('c.score >= %s', n); end if;
    if op = 'menor' then return format('c.score < %s', n); end if;
  end if;
  raise exception 'condição de segmento inválida: %', c::text;
end;
$fn$;

create or replace function public.sf_where_regras(p_regras jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  partes text[] := '{}';
  c jsonb;
  juntar text := case when p_regras->>'combinar' = 'qualquer' then ' or ' else ' and ' end;
begin
  for c in select * from jsonb_array_elements(coalesce(p_regras->'condicoes', '[]'::jsonb)) loop
    partes := partes || ('(' || public.sf_condicao_sql(c) || ')');
  end loop;
  if cardinality(partes) = 0 then return 'true'; end if;
  return '(' || array_to_string(partes, juntar) || ')';
end;
$fn$;

-- Página de contatos que casam com as regras (+ busca livre), com o total.
create or replace function public.sf_filtrar_contatos(
  p_regras jsonb,
  p_busca text default null,
  p_limite int default 100,
  p_offset int default 0
)
returns table (id uuid, total bigint)
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
declare
  w text := public.sf_where_regras(coalesce(p_regras, '{}'::jsonb));
  b text;
begin
  if coalesce(btrim(p_busca), '') <> '' then
    b := '%' || replace(replace(btrim(p_busca), '%', '\%'), '_', '\_') || '%';
    w := w || format(' and (c.nome ilike %1$L or c.email ilike %1$L or c.telefone ilike %1$L or c.empresa ilike %1$L)', b);
  end if;
  return query execute format(
    'select c.id, count(*) over () from public.contacts c where %s order by c.criado_em desc, c.id limit %s offset %s',
    w, greatest(1, least(coalesce(p_limite, 100), 1000)), greatest(0, coalesce(p_offset, 0)));
end;
$fn$;

-- ── 4. Tags de contato ───────────────────────────────────────────────────────────

create or replace function public.sf_tags_contato()
returns table (tag text, total bigint)
language sql
stable
set search_path = public, pg_temp
as $fn$
  select t, count(*) from public.contacts, unnest(tags) as t group by t order by count(*) desc, t;
$fn$;

create or replace function public.sf_renomear_tag(p_de text, p_para text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
begin
  if coalesce(btrim(p_para), '') = '' then raise exception 'nome novo vazio'; end if;
  update public.contacts
     set tags = (select array_agg(distinct x) from unnest(array_replace(tags, p_de, btrim(p_para))) x)
   where tags @> array[p_de];
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.sf_apagar_tag(p_tag text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
begin
  update public.contacts set tags = array_remove(tags, p_tag) where tags @> array[p_tag];
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- ── Permissões: só o servidor (service_role) ─────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.sf_evento_contato()',
    'public.sf_recalcular_score(uuid)',
    'public.sf_score_no_evento()',
    'public.sf_condicao_sql(jsonb)',
    'public.sf_where_regras(jsonb)',
    'public.sf_filtrar_contatos(jsonb, text, integer, integer)',
    'public.sf_tags_contato()',
    'public.sf_renomear_tag(text, text)',
    'public.sf_apagar_tag(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 0024_sem_categoria_expedicoes.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0024 — Sai a categoria "Expedições" (24/09/2026).
--
-- A Gestão de Grupos não usa essa frente: nenhuma campanha, sequência, recorrência ou
-- cadência foi criada nela (conferido antes de rodar: 0 linhas em todas). Ficam Lives,
-- Comunidade e Avulsas. O `update` de segurança joga qualquer sobra em "avulsas" antes
-- de apertar o CHECK — sem ele, uma linha esquecida faria a migration falhar.

update public.campaigns    set categoria = 'avulsas' where categoria = 'expedicoes';
update public.sequences    set categoria = 'avulsas' where categoria = 'expedicoes';
update public.recorrencias set categoria = 'avulsas' where categoria = 'expedicoes';
update public.cadencias    set categoria = 'avulsas' where categoria = 'expedicoes';

alter table public.campaigns    drop constraint if exists campaigns_categoria_check;
alter table public.sequences    drop constraint if exists sequences_categoria_check;
alter table public.recorrencias drop constraint if exists recorrencias_categoria_check;
alter table public.cadencias    drop constraint if exists cadencias_categoria_check;

alter table public.campaigns add constraint campaigns_categoria_check
  check (categoria in ('lives', 'comunidade', 'avulsas'));
alter table public.sequences add constraint sequences_categoria_check
  check (categoria in ('lives', 'comunidade', 'avulsas'));
alter table public.recorrencias add constraint recorrencias_categoria_check
  check (categoria in ('lives', 'comunidade', 'avulsas'));
alter table public.cadencias add constraint cadencias_categoria_check
  check (categoria in ('lives', 'comunidade', 'avulsas'));

-- ═════════════════════════════════════════════════════════════════════════════
-- 0025_instagram.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0025 — Instagram no módulo ManyChat (24/09/2026).
--
-- Conexão pelo "Login do Instagram para Empresas" (Instagram API with Instagram Login):
-- a pessoa entra com a conta profissional do @ e o SendFlow recebe um token que vale
-- 60 dias — renovado sozinho pelo tick (sf_ig_* guarda no Vault, como os tokens da Meta).
--
-- O que o ManyChat mais usa no Instagram, e é o que esta migration sustenta:
--   • comentário no post → mensagem privada (a "private reply", 1 por comentário, até 7 dias)
--     + resposta pública no comentário;
--   • palavra-chave na DM → resposta;
--   • resposta a story e menção em story → resposta;
--   • primeira mensagem → boas-vindas.
--
-- Janela do Instagram: resposta livre só até 24 h depois da última mensagem da pessoa
-- (ultima_entrada_em). Fora dela a Meta recusa — a tela avisa em vez de deixar falhar.

-- ── Segredos de configuração: a chave do app do Instagram entra na lista ─────────

create or replace function public.sf_cfg_guardar_segredo(p_nome text, p_valor text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
  v_nome text := 'sendflow_cfg_' || p_nome;
begin
  if p_nome is null or p_nome not in ('meta_app_secret', 'resend_api_key', 'resend_webhook_secret', 'instagram_app_secret') then
    raise exception 'segredo desconhecido: %', p_nome;
  end if;
  if p_valor is null or length(p_valor) < 16 then
    raise exception 'valor inválido';
  end if;
  select id into v_seg from vault.secrets where name = v_nome;
  if v_seg is null then
    perform vault.create_secret(p_valor, v_nome, 'Configuração do SendFlow: ' || p_nome);
  else
    perform vault.update_secret(v_seg, p_valor, v_nome);
  end if;
end;
$fn$;

create or replace function public.sf_cfg_segredo(p_nome text)
returns text
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $fn$
  select d.decrypted_secret
    from vault.decrypted_secrets d
   where p_nome in ('meta_app_secret', 'resend_api_key', 'resend_webhook_secret', 'instagram_app_secret')
     and d.name = 'sendflow_cfg_' || p_nome
   limit 1;
$fn$;

create or replace function public.sf_cfg_apagar_segredo(p_nome text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
begin
  if p_nome is null or p_nome not in ('meta_app_secret', 'resend_api_key', 'resend_webhook_secret', 'instagram_app_secret') then
    raise exception 'segredo desconhecido: %', p_nome;
  end if;
  delete from vault.secrets where name = 'sendflow_cfg_' || p_nome;
end;
$fn$;

-- ── Contas conectadas ────────────────────────────────────────────────────────────

create table if not exists public.ig_contas (
  id uuid primary key default gen_random_uuid(),
  ig_user_id text not null unique,
  username text,
  nome text,
  foto_url text,
  segredo_id uuid,
  token_expira_em timestamptz,
  status text not null default 'conectada' check (status in ('conectada', 'desconectada', 'erro')),
  webhook_assinado_em timestamptz,
  ultima_entrada_em timestamptz,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.ig_contas enable row level security;

create or replace function public.sf_ig_guardar_token(p_conta uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
  v_nome text := 'sendflow_ig_' || p_conta::text;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'token inválido'; end if;
  select id into v_seg from vault.secrets where name = v_nome;
  if v_seg is null then
    v_seg := vault.create_secret(p_token, v_nome, 'Token do Instagram (SendFlow) da conta ' || p_conta::text);
  else
    perform vault.update_secret(v_seg, p_token, v_nome);
  end if;
  update public.ig_contas set segredo_id = v_seg where id = p_conta;
  return v_seg;
end;
$fn$;

create or replace function public.sf_ig_token(p_ig_user_id text)
returns text
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $fn$
  select d.decrypted_secret
    from public.ig_contas c
    join vault.decrypted_secrets d on d.id = c.segredo_id
   where c.ig_user_id = p_ig_user_id
   limit 1;
$fn$;

create or replace function public.sf_ig_apagar_token(p_conta uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
begin
  select segredo_id into v_seg from public.ig_contas where id = p_conta;
  if v_seg is not null then
    delete from vault.secrets where id = v_seg;
    update public.ig_contas set segredo_id = null where id = p_conta;
  end if;
end;
$fn$;

-- ── Conversas (DM) ───────────────────────────────────────────────────────────────

create table if not exists public.ig_conversas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.ig_contas (id) on delete cascade,
  -- IGSID: o id da pessoa DENTRO desta conta (não é o id público do perfil).
  igsid text not null,
  username text,
  nome text,
  tags text[] not null default '{}',
  ultima_entrada_em timestamptz,
  ultima_mensagem_em timestamptz,
  ultima_previa text,
  nao_lidas integer not null default 0,
  automacao_pausada_ate timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (conta_id, igsid)
);
create index if not exists ig_conversas_recentes_idx on public.ig_conversas (conta_id, ultima_mensagem_em desc);
alter table public.ig_conversas enable row level security;

create table if not exists public.ig_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.ig_conversas (id) on delete cascade,
  direcao text not null check (direcao in ('entrada', 'saida')),
  tipo text not null default 'texto',
  texto text,
  payload jsonb not null default '{}'::jsonb,
  -- mid da Meta: é o que torna o webhook idempotente (a Meta reentrega o mesmo evento).
  mid text unique,
  status text not null default 'ok' check (status in ('ok', 'falha')),
  erro text,
  origem text not null default 'cliente' check (origem in ('cliente', 'manual', 'automacao', 'eco')),
  automacao_id uuid,
  criado_em timestamptz not null default now()
);
create index if not exists ig_mensagens_conversa_idx on public.ig_mensagens (conversa_id, criado_em);
alter table public.ig_mensagens enable row level security;

-- ── Comentários ──────────────────────────────────────────────────────────────────

create table if not exists public.ig_comentarios (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.ig_contas (id) on delete cascade,
  comment_id text not null unique,
  media_id text,
  from_id text,
  from_username text,
  texto text,
  automacao_id uuid,
  respondido_dm_em timestamptz,
  respondido_publico_em timestamptz,
  erro text,
  criado_em timestamptz not null default now()
);
create index if not exists ig_comentarios_conta_idx on public.ig_comentarios (conta_id, criado_em desc);
alter table public.ig_comentarios enable row level security;

-- ── Automações ───────────────────────────────────────────────────────────────────

create table if not exists public.ig_automacoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.ig_contas (id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  gatilho text not null check (gatilho in ('comentario', 'dm_palavra', 'story_resposta', 'story_mencao', 'boas_vindas')),
  -- palavras (text[]), qualquer_palavra (bool), posts (text[] de media_id; vazio = todos),
  -- respostas_publicas (text[], sorteia uma), dm_texto, dm_botoes [{titulo,url}], tags (text[])
  config jsonb not null default '{}'::jsonb,
  disparos integer not null default 0,
  ultimo_disparo_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists ig_automacoes_conta_idx on public.ig_automacoes (conta_id, gatilho) where ativo;
alter table public.ig_automacoes enable row level security;

alter table public.ig_mensagens
  add constraint ig_mensagens_automacao_fk foreign key (automacao_id) references public.ig_automacoes (id) on delete set null;
alter table public.ig_comentarios
  add constraint ig_comentarios_automacao_fk foreign key (automacao_id) references public.ig_automacoes (id) on delete set null;

-- Contador sem corrida (dois webhooks ao mesmo tempo não perdem um disparo).
create or replace function public.sf_ig_contar_disparo(p_automacao uuid)
returns void
language sql
set search_path = public, pg_temp
as $fn$
  update public.ig_automacoes set disparos = disparos + 1, ultimo_disparo_em = now() where id = p_automacao;
$fn$;

-- ── Permissões: só o servidor ────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.sf_cfg_guardar_segredo(text, text)',
    'public.sf_cfg_segredo(text)',
    'public.sf_cfg_apagar_segredo(text)',
    'public.sf_ig_guardar_token(uuid, text)',
    'public.sf_ig_token(text)',
    'public.sf_ig_apagar_token(uuid)',
    'public.sf_ig_contar_disparo(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
