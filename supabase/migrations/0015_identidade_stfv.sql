-- supabase/migrations/0015_identidade_stfv.sql
-- Identidade da Se Tu For, Eu Vou! Viagens nos dados que já vêm prontos.
--
-- Os três modelos da 0011 nasceram com a paleta do projeto de origem (azul #0147FF,
-- "SUA MARCA"). Aqui viram verde-petróleo #09282B, lima #D7F264 e off-white #F8F6F7 —
-- a mesma paleta do portal e das LPs. Botão lima leva texto verde-petróleo (12,4:1).
--
-- Só troca o que ainda está com o valor de fábrica: um modelo que alguém já editou no
-- app não é sobrescrito (o `where html like` casa só o texto original).

update public.email_templates set html = replace(replace(replace(replace(replace(replace(replace(
    html,
    'background:#f4f6fb;', 'background:#F8F6F7;'),
    'background:#0147FF;padding:22px 28px;', 'background:#09282B;padding:22px 28px;'),
    'color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.08em;">SUA MARCA', 'color:#D7F264;font-size:15px;font-weight:700;letter-spacing:.12em;">SE TU FOR, EU VOU! VIAGENS'),
    'color:#0A0F1F;', 'color:#09282B;'),
    'color:#3d4660;', 'color:#3F5E5B;'),
    'background:#0147FF;border-radius:10px;', 'background:#D7F264;border-radius:10px;'),
    'font-weight:600;color:#ffffff;text-decoration:none;">Quero saber mais', 'font-weight:600;color:#09282B;text-decoration:none;">Quero saber mais')
  where nome = 'Anúncio simples' and html like '%SUA MARCA%';

update public.email_templates set html = replace(replace(replace(replace(replace(replace(replace(replace(
    html,
    'background:#f4f6fb;', 'background:#F8F6F7;'),
    'background:#0A0F1F;padding:26px 28px;', 'background:#09282B;padding:26px 28px;'),
    'color:#7fa6ff;', 'color:#D7F264;'),
    'AULA AO VIVO', 'LIVE AO VIVO'),
    'color:#0A0F1F;', 'color:#09282B;'),
    'color:#3d4660;', 'color:#3F5E5B;'),
    'background:#00a37a;border-radius:10px;', 'background:#D7F264;border-radius:10px;'),
    'font-weight:600;color:#ffffff;text-decoration:none;">Entrar na aula', 'font-weight:600;color:#09282B;text-decoration:none;">Entrar na live')
  where nome = 'Convite para evento ou aula' and html like '%#00a37a%';

update public.email_templates
   set nome = 'Convite para live',
       assunto_sugerido = '{{nome}}, sua vaga na live desta semana',
       descricao = 'Data, hora e link em destaque. Feito para a pessoa entender em 3 segundos quando é a live e onde entra.'
 where nome = 'Convite para evento ou aula';

update public.email_templates set html = replace(replace(replace(
    html,
    'color:#0147FF;', 'color:#09282B;font-weight:600;'),
    'color:#1d2436;', 'color:#09282B;'),
    '<strong>Seu nome</strong>', '<strong>Equipe Se Tu For, Eu Vou!</strong>')
  where nome = 'Texto puro (o que mais chega na caixa de entrada)' and html like '%#0147FF%';

-- Remetente padrão: nome e rodapé com os dados cadastrais oficiais (CNPJ e endereço
-- aparecem no rodapé de todo e-mail — é exigência de entregabilidade e da LGPD mostrar
-- quem manda). O endereço de e-mail fica vazio até o domínio ser verificado no Resend.
update public.app_settings
   set valor = valor
     || jsonb_build_object('nome', 'Se Tu For, Eu Vou! Viagens')
     || jsonb_build_object('rodape_endereco', 'Se Tu For, Eu Vou! Viagens · CNPJ 53.545.815/0001-12 · Av. Dr. Chucri Zaidan, 1550 — Morumbi, São Paulo — SP, 04711-130')
 where chave = 'email_remetente'
   and coalesce(valor->>'nome', '') = ''
   and coalesce(valor->>'rodape_endereco', '') = '';
