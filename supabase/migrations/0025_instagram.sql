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
