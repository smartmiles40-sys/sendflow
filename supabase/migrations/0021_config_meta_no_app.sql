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
