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
