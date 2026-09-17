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
