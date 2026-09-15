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
-- Tirar o EXECUTE de anon/authenticated impede que alguém com a chave pública do
-- Supabase (que vai no navegador, por definição) chame `registrar_descadastro` em
-- massa e derrube a base inteira.
revoke execute on function public.registrar_abertura(text, text, text) from anon, authenticated;
revoke execute on function public.registrar_clique(text, text, text, text) from anon, authenticated;
revoke execute on function public.registrar_descadastro(text) from anon, authenticated;
revoke execute on function public.registrar_falha_email(text, text, text) from anon, authenticated;
revoke execute on function public.registrar_entrega_email(text) from anon, authenticated;
