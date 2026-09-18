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
