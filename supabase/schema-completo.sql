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
