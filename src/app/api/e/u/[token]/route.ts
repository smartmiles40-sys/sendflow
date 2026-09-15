import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Descadastro.
 *
 * Dois caminhos chegam aqui, e os dois precisam funcionar:
 *   • GET  — a pessoa clicou em "Descadastrar meu e-mail" no rodapé.
 *   • POST — o botão "Cancelar inscrição" do próprio Gmail/Yahoo, via o cabeçalho
 *            `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Desde 2024
 *            isso é EXIGÊNCIA para quem manda volume: sem ele, a entrega degrada em
 *            silêncio e o sintoma aparece como "a taxa de abertura caiu".
 *
 * Um clique, sem confirmação e sem login. Pôr obstáculo aqui é o que transforma um
 * descadastro em uma denúncia de spam — e denúncia de spam machuca o domínio inteiro,
 * enquanto um descadastro custa um contato.
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

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await descadastrar(token);
  // O provedor espera só um 200; ninguém lê este corpo.
  return new Response('OK', { status: 200 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = await descadastrar(token);
  return new Response(pagina(ok), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Página de confirmação. HTML inline, sem depender do layout do app: esta é a única
 * tela do sistema que um estranho vê, e ela precisa carregar mesmo que o resto esteja
 * fora do ar. Sem JavaScript, sem fonte externa, sem imagem.
 */
function pagina(ok: boolean): string {
  const titulo = ok ? 'Pronto, você saiu da lista' : 'Não encontramos este cadastro';
  const texto = ok
    ? 'Você não vai mais receber nossos e-mails. Se foi sem querer, é só falar com a gente que a inscrição volta.'
    : 'O link pode ter expirado ou o descadastro já foi feito antes. De qualquer forma, você não está mais na lista.';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${titulo}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    padding: 24px; background: #f4f6fb; color: #0a0f1f;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  }
  .cartao {
    background: #fff; border-radius: 16px; padding: 36px 32px; max-width: 460px; width: 100%;
    box-shadow: 0 12px 40px rgba(10,15,31,.10); text-align: center;
  }
  h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
  p  { margin: 0; color: #5a6480; }
  .marca { margin-top: 26px; font-size: 12px; letter-spacing: .14em; color: #98a1ba; }
  @media (prefers-color-scheme: dark) {
    body { background: #04070f; color: #f6f8ff; }
    .cartao { background: #0a0f1f; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
    p { color: #8c99b6; }
  }
</style>
</head>
<body>
  <main class="cartao">
    <h1>${titulo}</h1>
    <p>${texto}</p>
    <div class="marca">SENDFLOW</div>
  </main>
</body>
</html>`;
}
