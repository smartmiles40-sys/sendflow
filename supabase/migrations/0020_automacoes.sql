-- supabase/migrations/0020_automacoes.sql
-- Automações no estilo ManyChat, só para a API oficial do WhatsApp (Cloud API).
--
-- Até a 0019 o SendFlow só EMPURRAVA mensagem: campanha sai, recibo volta, fim. O que
-- o ManyChat faz — e o que esta migration traz — é CONVERSAR: a pessoa escreve
-- "japão", o sistema responde com botões, guarda a escolha num campo, põe uma tag,
-- espera dois dias e manda o próximo passo. Para isso o banco precisa de quatro coisas
-- que não existiam:
--
--   1. a CONVERSA como entidade (wa_conversas + wa_mensagens): sem ela não há janela
--      de 24 h, não há caixa de entrada e não há "pausar o robô para um humano";
--   2. o FLUXO (fluxos): um grafo de nós desenhado na tela, guardado inteiro em jsonb;
--   3. o GATILHO (fluxo_gatilhos): o que faz um fluxo começar — palavra-chave, primeira
--      mensagem, link de referência, anúncio de clique para o WhatsApp…;
--   4. a EXECUÇÃO (fluxo_execucoes): onde cada pessoa está dentro de cada fluxo. É ela
--      que aguenta "espere 2 dias" e "espere a resposta" sem nenhum processo parado
--      esperando — o estado está na linha, e o tick acorda quem chegou a hora.
--
-- E, junto, a conexão pelo botão da Meta (Cadastro Incorporado, igual ao QS): o token
-- de cada número vai para o Vault, criptografado. A tabela guarda só o id do segredo.

-- ── 1. A conexão pelo botão da Meta ──────────────────────────────────────────────

-- Id do segredo no Vault com o token DESTE número. Nulo = usa META_ACCESS_TOKEN do
-- ambiente (o jeito antigo, que continua valendo para quem cadastrou à mão).
alter table public.connections add column if not exists segredo_id uuid;
-- 'cloud' = número só na API; 'coexistencia' = WhatsApp Business do celular + API.
alter table public.connections add column if not exists modo_meta text;
alter table public.connections drop constraint if exists connections_modo_meta_check;
alter table public.connections add constraint connections_modo_meta_check
  check (modo_meta is null or modo_meta in ('cloud', 'coexistencia'));
-- Quando o webhook DESTE número foi apontado para o SendFlow (override por número).
alter table public.connections add column if not exists webhook_apontado_em timestamptz;
-- Última mensagem de cliente que entrou por este número: é a prova de que a volta
-- funciona. Sem ela, "ninguém respondeu" e "o webhook morreu" parecem a mesma coisa.
alter table public.connections add column if not exists ultima_entrada_em timestamptz;

create or replace function public.sf_meta_guardar_token(p_conexao uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
  v_nome text := 'sendflow_meta_' || p_conexao::text;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'token inválido';
  end if;
  select id into v_seg from vault.secrets where name = v_nome;
  if v_seg is null then
    v_seg := vault.create_secret(p_token, v_nome, 'Token da Cloud API (SendFlow) da conexão ' || p_conexao::text);
  else
    perform vault.update_secret(v_seg, p_token, v_nome);
  end if;
  update public.connections set segredo_id = v_seg where id = p_conexao;
  return v_seg;
end;
$fn$;

create or replace function public.sf_meta_token(p_phone text)
returns text
language sql
security definer
stable
set search_path = public, vault, pg_temp
as $fn$
  select d.decrypted_secret
    from public.connections c
    join vault.decrypted_secrets d on d.id = c.segredo_id
   where c.phone_number_id = p_phone
   limit 1;
$fn$;

create or replace function public.sf_meta_apagar_token(p_conexao uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_seg uuid;
begin
  select segredo_id into v_seg from public.connections where id = p_conexao;
  if v_seg is not null then
    delete from vault.secrets where id = v_seg;
    update public.connections set segredo_id = null where id = p_conexao;
  end if;
end;
$fn$;

-- ── 2. Campos personalizados (os "User Fields" do ManyChat) ──────────────────────
--
-- O VALOR já tinha casa: `contacts.campos` (jsonb, desde a 0007). Faltava a DEFINIÇÃO
-- — o tipo, o rótulo bonito — para a tela oferecer uma lista em vez de um campo de
-- texto livre onde "cidade", "Cidade" e "cidade " viram três campos diferentes.

create table if not exists public.contact_fields (
  id uuid primary key default gen_random_uuid(),
  -- A chave usada em {{chave}} e em contacts.campos. Minúsculas, número e _.
  chave text not null check (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  rotulo text not null,
  tipo text not null default 'texto'
    check (tipo in ('texto', 'numero', 'data', 'sim_nao', 'email', 'telefone')),
  descricao text,
  criado_em timestamptz not null default now()
);
create unique index if not exists contact_fields_chave_uidx on public.contact_fields (chave);
alter table public.contact_fields enable row level security;

-- ── 3. A conversa ────────────────────────────────────────────────────────────────

create table if not exists public.wa_conversas (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  -- O `wa_id` exatamente como a Meta manda. É para ELE que se responde: no Brasil a
  -- Meta às vezes conhece o número SEM o nono dígito, e responder para o número
  -- "consertado" cai em outra pessoa ou em lugar nenhum.
  wa_id text not null,
  nome_perfil text,
  -- A janela de 24 h conta da ÚLTIMA mensagem da pessoa, não da nossa.
  ultima_entrada_em timestamptz,
  ultima_mensagem_em timestamptz,
  ultima_previa text,
  nao_lidas integer not null default 0,
  -- "Pausar automação": enquanto no futuro, nenhum fluxo responde esta pessoa. É o
  -- botão que o atendente aperta ao assumir a conversa, igual ao Live Chat do ManyChat.
  automacao_pausada_ate timestamptz,
  status text not null default 'aberta' check (status in ('aberta', 'fechada')),
  -- Trava curta contra duas mensagens seguidas disparando o mesmo fluxo duas vezes.
  processando_ate timestamptz,
  -- Resposta padrão: quando foi a última, para respeitar "no máximo 1x a cada N horas".
  resposta_padrao_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists wa_conversas_uidx on public.wa_conversas (connection_id, wa_id);
create index if not exists wa_conversas_recentes_idx on public.wa_conversas (ultima_mensagem_em desc nulls last);
create index if not exists wa_conversas_contato_idx on public.wa_conversas (contact_id);

drop trigger if exists trg_wa_conversas_touch on public.wa_conversas;
create trigger trg_wa_conversas_touch before update on public.wa_conversas
for each row execute function public.touch_atualizado_em();
alter table public.wa_conversas enable row level security;

create table if not exists public.wa_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.wa_conversas(id) on delete cascade,
  direcao text not null check (direcao in ('in', 'out')),
  -- texto | imagem | video | audio | documento | figurinha | botoes | lista | link |
  -- template | resposta_botao | resposta_lista | localizacao | contato | reacao | outro
  tipo text not null default 'texto',
  texto text,
  -- O corpo completo (botões, mídia, id do botão clicado…). A tela desenha a partir dele.
  payload jsonb,
  wamid text,
  status text check (status is null or status in ('enviado', 'entregue', 'lido', 'falha')),
  erro text,
  -- Quem produziu a mensagem que saiu: um fluxo, um atendente, uma campanha.
  origem text check (origem is null or origem in ('fluxo', 'manual', 'campanha', 'teste')),
  fluxo_id uuid,
  no_id text,
  criado_em timestamptz not null default now()
);

create unique index if not exists wa_mensagens_wamid_uidx on public.wa_mensagens (wamid) where wamid is not null;
create index if not exists wa_mensagens_conversa_idx on public.wa_mensagens (conversa_id, criado_em desc);
alter table public.wa_mensagens enable row level security;

-- ── 4. O fluxo ───────────────────────────────────────────────────────────────────

create table if not exists public.fluxos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  -- Nulo = responde por qualquer número oficial conectado.
  connection_id uuid references public.connections(id) on delete set null,
  status text not null default 'rascunho' check (status in ('rascunho', 'ativo', 'pausado')),
  -- {"nos":[{"id","tipo","x","y","dados"}], "ligacoes":[{"id","de","saida","para"}]}
  grafo jsonb not null default '{"nos":[],"ligacoes":[]}'::jsonb,
  pasta text,
  execucoes_total integer not null default 0,
  concluidas_total integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
drop trigger if exists trg_fluxos_touch on public.fluxos;
create trigger trg_fluxos_touch before update on public.fluxos
for each row execute function public.touch_atualizado_em();
alter table public.fluxos enable row level security;

create table if not exists public.fluxo_gatilhos (
  id uuid primary key default gen_random_uuid(),
  fluxo_id uuid not null references public.fluxos(id) on delete cascade,
  tipo text not null check (tipo in (
    'palavra_chave',  -- a pessoa escreveu (ou clicou num botão com) tal palavra
    'boas_vindas',    -- a PRIMEIRA mensagem que esta pessoa manda para o número
    'padrao',         -- nada mais casou: a "resposta padrão"
    'link_ref',       -- chegou pelo link wa.me com o código de referência
    'anuncio',        -- chegou por anúncio de clique para o WhatsApp
    'tag_adicionada', -- alguém/algo pôs esta tag no contato
    'webhook'         -- sistema de fora (formulário da LP, n8n) pediu para iniciar
  )),
  -- palavra_chave: {"palavras":["japão","japao"],"modo":"contem|exata|comeca"}
  -- link_ref:      {"codigo":"live-peru","texto":"Quero saber da live do Peru"}
  -- anuncio:       {"ad_ids":["1202…"]}  (vazio = qualquer anúncio)
  -- tag_adicionada:{"tag":"quente"}
  -- padrao:        {"intervalo_horas":24}
  -- webhook:       {"token":"…"}
  config jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  -- Maior primeiro. Empate: o mais antigo.
  prioridade smallint not null default 0,
  disparos integer not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists fluxo_gatilhos_tipo_idx on public.fluxo_gatilhos (tipo) where ativo;
create index if not exists fluxo_gatilhos_fluxo_idx on public.fluxo_gatilhos (fluxo_id);
-- Um código de link de referência aponta para UM fluxo só.
create unique index if not exists fluxo_gatilhos_ref_uidx
  on public.fluxo_gatilhos ((lower(config ->> 'codigo'))) where tipo = 'link_ref';
alter table public.fluxo_gatilhos enable row level security;

-- ── 5. A execução: onde cada pessoa está em cada fluxo ───────────────────────────

create table if not exists public.fluxo_execucoes (
  id uuid primary key default gen_random_uuid(),
  fluxo_id uuid not null references public.fluxos(id) on delete cascade,
  conversa_id uuid not null references public.wa_conversas(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  gatilho_id uuid references public.fluxo_gatilhos(id) on delete set null,
  no_atual text,
  estado text not null default 'rodando' check (estado in (
    'rodando', 'aguardando_resposta', 'aguardando_tempo', 'concluida', 'cancelada', 'erro'
  )),
  -- Quando o tick deve mexer nesta execução: fim do "aguarde", ou o prazo da pergunta.
  acordar_em timestamptz,
  -- O que o nó parado espera: {"tipo":"botoes","saidas":{"id_do_botao":"b1"}} ou
  -- {"tipo":"pergunta","tentativas":1}.
  aguardando jsonb,
  -- Contador anti-laço: um fluxo que volta para si mesmo não pode rodar para sempre.
  passos integer not null default 0,
  erro text,
  -- Trava do tick: duas execuções simultâneas do motor não pegam a mesma linha.
  travada_ate timestamptz,
  iniciada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  concluida_em timestamptz
);
create index if not exists fluxo_execucoes_acordar_idx
  on public.fluxo_execucoes (acordar_em) where estado in ('aguardando_tempo', 'aguardando_resposta');
create index if not exists fluxo_execucoes_conversa_idx
  on public.fluxo_execucoes (conversa_id) where estado in ('rodando', 'aguardando_resposta', 'aguardando_tempo');
create index if not exists fluxo_execucoes_fluxo_idx on public.fluxo_execucoes (fluxo_id, iniciada_em desc);
alter table public.fluxo_execucoes enable row level security;

-- Cada passo que importa, para os números que aparecem EM CIMA de cada nó no editor
-- (quantos entraram, quantos clicaram em cada botão). Tabela estreita e só-inserção.
create table if not exists public.fluxo_eventos (
  id bigserial primary key,
  fluxo_id uuid not null references public.fluxos(id) on delete cascade,
  execucao_id uuid references public.fluxo_execucoes(id) on delete cascade,
  no_id text not null,
  -- entrou | enviou | saida | erro
  tipo text not null,
  saida text,
  detalhe text,
  criado_em timestamptz not null default now()
);
create index if not exists fluxo_eventos_fluxo_idx on public.fluxo_eventos (fluxo_id, no_id, tipo);
alter table public.fluxo_eventos enable row level security;

-- Contagem por nó sem trazer as linhas para a aplicação.
create or replace function public.sf_estatisticas_fluxo(p_fluxo uuid)
returns table (no_id text, tipo text, saida text, total bigint)
language sql
security definer
stable
set search_path = public
as $fn$
  select e.no_id, e.tipo, coalesce(e.saida, ''), count(*)
    from public.fluxo_eventos e
   where e.fluxo_id = p_fluxo
   group by 1, 2, 3;
$fn$;

-- ── 6. Travas atômicas ───────────────────────────────────────────────────────────

-- Toma a conversa por alguns segundos. Devolve false se outra requisição já está
-- tratando esta pessoa — duas mensagens em sequência ("oi" + "japão") não podem abrir
-- dois fluxos de boas-vindas.
create or replace function public.sf_tomar_conversa(p_conversa uuid, p_segundos int default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  ok boolean;
begin
  update public.wa_conversas
     set processando_ate = now() + make_interval(secs => greatest(1, least(p_segundos, 120)))
   where id = p_conversa
     and (processando_ate is null or processando_ate < now())
  returning true into ok;
  return coalesce(ok, false);
end;
$fn$;

create or replace function public.sf_soltar_conversa(p_conversa uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.wa_conversas set processando_ate = null where id = p_conversa;
$fn$;

-- O tick pega as execuções vencidas e já as trava, com `skip locked` para dois ticks
-- simultâneos levarem lotes diferentes.
create or replace function public.sf_reivindicar_execucoes(p_limite int)
returns setof public.fluxo_execucoes
language sql
security definer
set search_path = public
as $fn$
  update public.fluxo_execucoes x
     set travada_ate = now() + interval '2 minutes'
   where x.id in (
     select e.id
       from public.fluxo_execucoes e
      where e.estado in ('aguardando_tempo', 'aguardando_resposta')
        and e.acordar_em is not null
        and e.acordar_em <= now()
        and (e.travada_ate is null or e.travada_ate < now())
      order by e.acordar_em
      limit greatest(1, least(p_limite, 200))
      for update skip locked
   )
  returning x.*;
$fn$;

-- Conta um disparo no gatilho e uma execução no fluxo, sem ler-somar-gravar na
-- aplicação (que perde contagem quando dois chegam juntos).
create or replace function public.sf_contar_disparo(p_gatilho uuid, p_fluxo uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.fluxo_gatilhos set disparos = disparos + 1 where id = p_gatilho;
  update public.fluxos set execucoes_total = execucoes_total + 1 where id = p_fluxo;
$fn$;

-- ── 7. Só o servidor chama (ver 0013: tirar de public NÃO basta no Supabase) ─────

revoke all on function public.sf_meta_guardar_token(uuid, text) from public;
revoke all on function public.sf_meta_guardar_token(uuid, text) from anon, authenticated;
grant execute on function public.sf_meta_guardar_token(uuid, text) to service_role;

revoke all on function public.sf_meta_token(text) from public;
revoke all on function public.sf_meta_token(text) from anon, authenticated;
grant execute on function public.sf_meta_token(text) to service_role;

revoke all on function public.sf_meta_apagar_token(uuid) from public;
revoke all on function public.sf_meta_apagar_token(uuid) from anon, authenticated;
grant execute on function public.sf_meta_apagar_token(uuid) to service_role;

revoke all on function public.sf_estatisticas_fluxo(uuid) from public;
revoke all on function public.sf_estatisticas_fluxo(uuid) from anon, authenticated;
grant execute on function public.sf_estatisticas_fluxo(uuid) to service_role;

revoke all on function public.sf_tomar_conversa(uuid, int) from public;
revoke all on function public.sf_tomar_conversa(uuid, int) from anon, authenticated;
grant execute on function public.sf_tomar_conversa(uuid, int) to service_role;

revoke all on function public.sf_soltar_conversa(uuid) from public;
revoke all on function public.sf_soltar_conversa(uuid) from anon, authenticated;
grant execute on function public.sf_soltar_conversa(uuid) to service_role;

revoke all on function public.sf_reivindicar_execucoes(int) from public;
revoke all on function public.sf_reivindicar_execucoes(int) from anon, authenticated;
grant execute on function public.sf_reivindicar_execucoes(int) to service_role;

revoke all on function public.sf_contar_disparo(uuid, uuid) from public;
revoke all on function public.sf_contar_disparo(uuid, uuid) from anon, authenticated;
grant execute on function public.sf_contar_disparo(uuid, uuid) to service_role;

-- ── 8. Configuração do botão "Conectar com a Meta" ───────────────────────────────
-- config_id do Cadastro Incorporado (Login do Facebook para Empresas). Não é segredo:
-- vai para o navegador de qualquer jeito.
insert into public.app_settings (chave, valor)
values ('meta_cadastro', '{"config_id": null}'::jsonb)
on conflict (chave) do nothing;
