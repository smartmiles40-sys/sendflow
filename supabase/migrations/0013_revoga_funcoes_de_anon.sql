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
