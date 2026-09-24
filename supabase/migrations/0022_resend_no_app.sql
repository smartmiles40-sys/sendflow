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
