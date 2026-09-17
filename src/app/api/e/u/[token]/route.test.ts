import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc }) }));

import { GET, POST } from './route';

const params = (token: string) => ({ params: Promise.resolve({ token }) });
const post = (corpo: string) =>
  new Request('https://x/api/e/u/tok', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: corpo,
  });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true });
});

describe('descadastro', () => {
  it('GET só mostra o botão — robô que abre o link não descadastra ninguém', async () => {
    const res = await GET();
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<form method="post">');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('o botão da página descadastra e mostra a confirmação', async () => {
    const res = await POST(post('confirmar=1'), params('tok'));
    expect(rpc).toHaveBeenCalledWith('registrar_descadastro', { p_token: 'tok' });
    expect(await res.text()).toContain('Pronto, você saiu da lista');
  });

  it('o um-clique do Gmail (RFC 8058) descadastra e recebe só OK', async () => {
    const res = await POST(post('List-Unsubscribe=One-Click'), params('tok'));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe('OK');
  });

  it('token de envio de teste nunca vai ao banco', async () => {
    const res = await POST(post('confirmar=1'), params('teste-abc'));
    expect(rpc).not.toHaveBeenCalled();
    expect(await res.text()).toContain('Não encontramos este cadastro');
  });
});
