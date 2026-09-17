import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Descadastro.
 *
 * Três caminhos chegam aqui:
 *   • GET  — a pessoa clicou em "Descadastrar meu e-mail" no rodapé. Mostra UM botão;
 *            NÃO descadastra.
 *   • POST do botão acima — descadastra e mostra a confirmação.
 *   • POST do próprio Gmail/Yahoo, via `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
 *     (RFC 8058) — descadastra e devolve só um 200. Desde 2024 isso é EXIGÊNCIA para quem
 *     manda volume: sem ele a entrega degrada em silêncio.
 *
 * Por que o GET não descadastra mais: antivírus de e-mail corporativo (Microsoft Safe
 * Links, Proofpoint, Mimecast) ABRE os links da mensagem para ver se são seguros, antes
 * de a pessoa ler. Com o descadastro no GET, contato de empresa com esse tipo de proteção
 * saía da lista sozinho — sem nunca ter pedido, e sem ninguém perceber. Esses robôs
 * seguem links, mas não enviam formulário; é por isso que a RFC 8058 exige POST.
 *
 * Continua sendo um clique, sem login: pôr obstáculo aqui é o que transforma um
 * descadastro em denúncia de spam, e denúncia machuca o domínio inteiro.
 */
async function descadastrar(token: string): Promise<boolean> {
  if (!token || token.startsWith('teste-')) return false;
  try {
    const supabase = createServerClient();
    const { data } = await supabase.rpc('registrar_descadastro', { p_token: token });
    return data === true;
  } catch {
    return false;
  }
}

/** O POST do Gmail/Yahoo manda exatamente `List-Unsubscribe=One-Click` no corpo. */
function ehUmCliqueDoProvedor(corpo: string): boolean {
  return /(^|&)List-Unsubscribe=One-Click(&|$)/i.test(corpo.trim());
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const corpo = await req.text().catch(() => '');
  const ok = await descadastrar(token);

  // O provedor espera só um 200; ninguém lê este corpo.
  if (ehUmCliqueDoProvedor(corpo)) return new Response('OK', { status: 200 });

  return html(ok ? 'feito' : 'nao-encontrado');
}

export async function GET() {
  return html('confirmar');
}

type Estado = 'confirmar' | 'feito' | 'nao-encontrado';

function html(estado: Estado): Response {
  return new Response(pagina(estado), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/**
 * Página única, HTML inline e sem depender do layout do app: é a única tela do sistema
 * que um estranho vê, e ela precisa carregar mesmo que o resto esteja fora do ar. Sem
 * JavaScript, sem fonte externa, sem imagem. O formulário posta para a própria URL.
 */
function pagina(estado: Estado): string {
  const conteudo = {
    confirmar: {
      titulo: 'Sair da lista de e-mails',
      texto: 'Clique no botão abaixo e você não recebe mais nossos e-mails.',
    },
    feito: {
      titulo: 'Pronto, você saiu da lista',
      texto:
        'Você não vai mais receber nossos e-mails. Se foi sem querer, é só falar com a gente que a inscrição volta.',
    },
    'nao-encontrado': {
      titulo: 'Não encontramos este cadastro',
      texto:
        'O link pode ter expirado ou o descadastro já foi feito antes. De qualquer forma, você não está mais na lista.',
    },
  }[estado];

  const botao =
    estado === 'confirmar'
      ? '<form method="post"><input type="hidden" name="confirmar" value="1"><button type="submit">Descadastrar meu e-mail</button></form>'
      : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${conteudo.titulo}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    padding: 24px; background: #F8F6F7; color: #09282B;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  }
  .cartao {
    background: #fff; border-radius: 16px; padding: 36px 32px; max-width: 460px; width: 100%;
    box-shadow: 0 12px 40px rgba(9,40,43,.10); text-align: center;
  }
  h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
  p  { margin: 0; color: #3F5E5B; }
  form { margin-top: 24px; }
  button {
    font: inherit; font-weight: 600; color: #09282B; background: #D7F264; border: 0;
    border-radius: 10px; padding: 14px 28px; min-height: 48px; width: 100%; cursor: pointer;
  }
  button:hover { background: #C0E046; }
  button:focus-visible { outline: 3px solid #09282B; outline-offset: 2px; }
  .marca { margin-top: 26px; font-size: 12px; letter-spacing: .14em; color: #6F8F8A; }
  @media (prefers-color-scheme: dark) {
    body { background: #051C1E; color: #F8F6F7; }
    .cartao { background: #09282B; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
    p { color: #8FAEA9; }
    button:focus-visible { outline-color: #D7F264; }
  }
</style>
</head>
<body>
  <main class="cartao">
    <h1>${conteudo.titulo}</h1>
    <p>${conteudo.texto}</p>
    ${botao}
    <div class="marca">SE TU FOR, EU VOU! VIAGENS</div>
  </main>
</body>
</html>`;
}
