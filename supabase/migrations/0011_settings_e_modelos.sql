-- supabase/migrations/0011_settings_e_modelos.sql
-- Configurações do app + os modelos de e-mail que já vêm prontos.

-- Chave/valor em jsonb: cabe um campo novo sem migration. Aqui NÃO entra segredo —
-- senha e chave de API moram em variável de ambiente, fora do banco.
create table if not exists public.app_settings (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

drop trigger if exists trg_app_settings_touch on public.app_settings;
create trigger trg_app_settings_touch before update on public.app_settings
for each row execute function public.touch_atualizado_em();

-- A função toca `atualizado_em`; a tabela usa o mesmo nome de coluna, então serve.
alter table public.app_settings enable row level security;

insert into public.app_settings (chave, valor) values
  ('email_remetente', '{
     "nome": "",
     "email": "",
     "responder_para": "",
     "rodape_endereco": "",
     "rodape_texto": "Você recebeu este e-mail porque se cadastrou em um de nossos canais."
   }'::jsonb)
on conflict (chave) do nothing;

insert into public.app_settings (chave, valor) values
  ('envio', '{
     "janela_inicio": "08:00",
     "janela_fim": "21:00",
     "respeitar_janela": false,
     "lote_email": 25
   }'::jsonb)
on conflict (chave) do nothing;

-- ── Modelos de e-mail ────────────────────────────────────────────────────────────
-- Três layouts que já resolvem o básico de entregabilidade e de leitura no celular:
-- tabela de largura fixa (Outlook não entende flexbox), largura máxima de 600px,
-- fonte de sistema, botão que é uma <table> (não um <a> estilizado, que o Outlook
-- desmonta) e um rodapé com o link de descadastro, que o app injeta no lugar de
-- {{descadastro}}. As variáveis {{nome}}, {{email}} e {{empresa}} são trocadas pelos
-- dados do contato no momento do envio.

insert into public.email_templates (nome, descricao, assunto_sugerido, html)
select 'Anúncio simples',
       'Um aviso direto: título, texto e um botão. O que mais converte quando você tem uma coisa só para dizer.',
       'Novidade: {{empresa}} tem um aviso para você',
$html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0147FF;padding:22px 28px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.08em;">SUA MARCA</p>
      </td></tr>
      <tr><td style="padding:32px 28px 8px;">
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#0A0F1F;">Olá, {{nome}}!</h1>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3d4660;">
          Escreva aqui o recado principal. Uma ideia por parágrafo, frases curtas — e-mail
          se lê no celular, em pé, com pressa.
        </p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3d4660;">
          Um segundo parágrafo, se precisar. Depois disso, o botão.
        </p>
      </td></tr>
      <tr><td align="center" style="padding:0 28px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="background:#0147FF;border-radius:10px;">
            <a href="https://exemplo.com.br" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Quero saber mais</a>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px 28px;background:#f4f6fb;font-size:12px;line-height:1.6;color:#7c86a0;">
        {{rodape}}
      </td></tr>
    </table>
  </td></tr>
</table>$html$
where not exists (select 1 from public.email_templates where nome = 'Anúncio simples');

insert into public.email_templates (nome, descricao, assunto_sugerido, html)
select 'Convite para evento ou aula',
       'Data, hora e link em destaque. Feito para a pessoa entender em 3 segundos quando é e onde entra.',
       '{{nome}}, sua vaga na aula desta semana',
$html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;">
      <tr><td style="background:#0A0F1F;padding:26px 28px;text-align:center;">
        <p style="margin:0 0 6px;color:#7fa6ff;font-size:12px;font-weight:700;letter-spacing:.14em;">AULA AO VIVO</p>
        <h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.25;">Tema da aula aqui</h1>
      </td></tr>
      <tr><td style="padding:26px 28px 6px;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#3d4660;">
          Oi, {{nome}}! Sua vaga está garantida. Anote os detalhes:
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;border-radius:10px;">
          <tr>
            <td style="padding:16px 18px;font-size:15px;line-height:1.7;color:#0A0F1F;">
              <strong>Quando:</strong> quinta-feira, 19h30<br>
              <strong>Onde:</strong> ao vivo, link abaixo<br>
              <strong>Duração:</strong> cerca de 1 hora
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:24px 28px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="background:#00a37a;border-radius:10px;">
            <a href="https://exemplo.com.br/aula" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Entrar na aula</a>
          </td>
        </tr></table>
        <p style="margin:14px 0 0;font-size:13px;color:#7c86a0;">Salve este e-mail — o link é o mesmo no dia.</p>
      </td></tr>
      <tr><td style="padding:20px 28px;background:#f4f6fb;font-size:12px;line-height:1.6;color:#7c86a0;">
        {{rodape}}
      </td></tr>
    </table>
  </td></tr>
</table>$html$
where not exists (select 1 from public.email_templates where nome = 'Convite para evento ou aula');

insert into public.email_templates (nome, descricao, assunto_sugerido, html)
select 'Texto puro (o que mais chega na caixa de entrada)',
       'Sem imagem e sem botão colorido: parece e-mail de pessoa, não de sistema. Costuma ser o que mais escapa da aba Promoções.',
       'uma pergunta rápida, {{nome}}',
$html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="padding:8px 24px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#1d2436;">Oi, {{nome}},</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#1d2436;">
          Escreva como se estivesse escrevendo para uma pessoa só. Sem banner, sem
          "prezado cliente". Uma pergunta ou uma observação específica funciona melhor
          do que um anúncio.
        </p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#1d2436;">
          Se quiser mandar para algum lugar, use um <a href="https://exemplo.com.br" style="color:#0147FF;">link no meio do texto</a> — ele é rastreado igual ao botão.
        </p>
        <p style="margin:0 0 6px;font-size:16px;line-height:1.7;color:#1d2436;">Abraço,</p>
        <p style="margin:0 0 28px;font-size:16px;line-height:1.7;color:#1d2436;"><strong>Seu nome</strong></p>
        <hr style="border:none;border-top:1px solid #e4e8f2;margin:0 0 14px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#8d96ad;">{{rodape}}</p>
      </td></tr>
    </table>
  </td></tr>
</table>$html$
where not exists (select 1 from public.email_templates where nome = 'Texto puro (o que mais chega na caixa de entrada)');
