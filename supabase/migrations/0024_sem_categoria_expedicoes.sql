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
