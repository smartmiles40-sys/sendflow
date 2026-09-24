import { NextResponse } from 'next/server';
import { readJson } from '@/lib/http';
import { conectarNumero, lerConfigCadastro } from '@/lib/whatsapp/meta-conexao';
import { salvarConfigMeta } from '@/lib/whatsapp/meta-config';

export const dynamic = 'force-dynamic';
// A conexão faz até 6 idas à Meta em sequência (troca, leitura, assinatura, registro,
// cofre, webhook). Com 10 s de folga padrão ela seria cortada no meio.
export const maxDuration = 60;

/** A configuração pública do botão "Conectar com a Meta". Nada aqui é segredo. */
export async function GET() {
  return NextResponse.json(await lerConfigCadastro());
}

/**
 * Guarda os dados do app da Meta colados na tela: App ID, chave secreta (vai para o
 * Vault e nunca volta) e o config_id do botão. Campo ausente = fica como está.
 */
export async function PUT(req: Request) {
  const parsed = await readJson<{ appId?: unknown; appSecret?: unknown; configId?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  const texto = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  const r = await salvarConfigMeta({
    appId: texto(b.appId),
    appSecret: texto(b.appSecret),
    configId: texto(b.configId),
  });
  if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, nomeDoApp: r.nomeDoApp, ...(await lerConfigCadastro()) });
}

/** O retorno da janela da Meta: código + ids → conexão pronta. */
export async function POST(req: Request) {
  const parsed = await readJson<{
    code?: unknown;
    wabaId?: unknown;
    phoneId?: unknown;
    modo?: unknown;
    pin?: unknown;
    nome?: unknown;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const b = parsed.data;
  const r = await conectarNumero({
    code: String(b.code ?? ''),
    wabaId: String(b.wabaId ?? ''),
    phoneId: String(b.phoneId ?? ''),
    modo: b.modo === 'coexistencia' ? 'coexistencia' : 'cloud',
    pin: b.pin ? String(b.pin) : null,
    nome: b.nome ? String(b.nome) : null,
  });
  if ('erro' in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r, { status: 201 });
}
