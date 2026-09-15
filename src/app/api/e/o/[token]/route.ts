import { createServerClient } from '@/lib/supabase/server';
import { ipDaRequisicao } from '@/lib/req';

export const dynamic = 'force-dynamic';

/**
 * PNG transparente de 1×1, o menor possível (68 bytes).
 * Fica embutido como base64 porque um arquivo em /public seria uma requisição a mais e
 * uma chance a mais de cair num cache que nunca chega até aqui.
 */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Pixel de abertura de e-mail.
 *
 * Como funciona: o `montarEmail` embute `<img src=".../api/e/o/<token>.png">` no fim do
 * corpo. Quando o cliente de e-mail carrega essa imagem, a requisição chega aqui e a
 * abertura é contada.
 *
 * O que ele NÃO mede, e é importante não enganar a equipe com isso:
 *   • quem lê com imagens bloqueadas (Outlook por padrão, muita gente no celular) não
 *     é contado — a abertura real é sempre MAIOR que a medida;
 *   • o Gmail busca a imagem pelo proxy dele, às vezes antes de a pessoa abrir, então
 *     uma parte das aberturas do Gmail é otimista;
 *   • a Proteção de Privacidade do Mail da Apple pré-carrega TODAS as imagens: para
 *     quem usa iPhone, "abriu" vira praticamente 100%.
 * Por isso o painel trata CLIQUE como o sinal forte e abertura como tendência. Está
 * documentado em docs/KPIS.md para ninguém tomar decisão com o número errado.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: bruto } = await params;
  // A URL termina em `.png` para parecer imagem a filtros e proxies que desconfiam de
  // caminho sem extensão.
  const token = bruto.replace(/\.(png|gif|jpg)$/i, '');

  // Token de teste não move KPI: quem manda o teste é a própria equipe.
  if (token && !token.startsWith('teste-')) {
    try {
      const supabase = createServerClient();
      await supabase.rpc('registrar_abertura', {
        p_token: token,
        p_user_agent: req.headers.get('user-agent') ?? null,
        p_ip: ipDaRequisicao(req),
      });
    } catch {
      // Uma falha ao contabilizar não pode deixar um buraco no e-mail de quem está lendo.
    }
  }

  return new Response(new Uint8Array(PIXEL), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(PIXEL.length),
      // Sem cache em nenhuma camada: um proxy que guardasse a resposta faria a segunda
      // abertura da mesma pessoa nunca chegar até aqui.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
