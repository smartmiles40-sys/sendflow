import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import {
  DURACOES_TEMPORARIAS,
  infoDoGrupoBruta,
  linkDoGrupo,
  mudarDescricaoGrupo,
  mudarFotoGrupo,
  mudarParticipantes,
  mudarRegraGrupo,
  mudarTemporarias,
  participantesBrutos,
  redefinirLinkDoGrupo,
  renomearGrupo,
  sairDoGrupo,
  type AcaoParticipante,
  type DuracaoTemporaria,
} from '@/lib/whatsapp/evolution';
import { abrirConexao, midiaDoSendflow, respostaDeErro } from '@/lib/whatsapp/celular-servidor';
import { explicarStatusParticipante, paraInfoGrupo } from '@/lib/whatsapp/grupo';
import { ehGrupo, normalizarDestino, normalizarTelefoneBR, telefoneValido } from '@/lib/whatsapp/jid';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function jidDoGrupo(bruto: string | null | undefined): string | null {
  const j = normalizarDestino(String(bruto ?? ''));
  return j && ehGrupo(j) ? j : null;
}

/** Dados do grupo para o painel "Dados do grupo": regras, participantes e o meu papel. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jid = jidDoGrupo(url.searchParams.get('jid'));
  if (!jid) return NextResponse.json({ error: 'Escolha um grupo.' }, { status: 400 });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, url.searchParams.get('conexao'));
  if ('res' in aberta) return aberta.res;
  const { conexao } = aberta;

  try {
    // Participantes numa chamada à parte: traz nome e foto, que a outra não traz. Se
    // falhar, a tela ainda abre com a lista crua da primeira.
    const [info, parts] = await Promise.all([
      infoDoGrupoBruta(conexao.instance_name, jid),
      participantesBrutos(conexao.instance_name, jid).catch(() => [] as unknown[]),
    ]);
    return NextResponse.json(paraInfoGrupo(info, parts, conexao.numero));
  } catch (e) {
    return respostaDeErro(e);
  }
}

type Pedido = {
  conexao?: string;
  jid?: string;
  acao?: string;
  valor?: unknown;
  /** Para `participantes`: add | remove | promote | demote. */
  operacao?: string;
  /** Para `participantes`: jids (remover/promover) ou telefones digitados (adicionar). */
  pessoas?: unknown;
};

/**
 * Uma alteração no grupo. Uma ação por chamada, de propósito: se o WhatsApp recusar,
 * a tela diz exatamente o que não foi feito.
 */
export async function POST(req: Request) {
  const parsed = await readJson<Pedido>(req);
  if (!parsed.ok) return parsed.res;
  const p = parsed.data;
  const jid = jidDoGrupo(p.jid);
  if (!jid) return NextResponse.json({ error: 'Escolha um grupo.' }, { status: 400 });

  const supabase = createServerClient();
  const aberta = await abrirConexao(supabase, p.conexao ?? null);
  if ('res' in aberta) return aberta.res;
  const inst = aberta.conexao.instance_name;
  const erro = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

  try {
    switch (p.acao) {
      case 'nome': {
        const nome = String(p.valor ?? '').trim();
        if (!nome) return erro('O nome do grupo não pode ficar vazio.');
        if (nome.length > 100) return erro('O WhatsApp aceita até 100 letras no nome do grupo.');
        await renomearGrupo(inst, jid, nome);
        // Mantém o nome igual no SendFlow, senão a lista mostra o nome antigo até sincronizar.
        await supabase.from('groups').update({ nome }).eq('group_id', jid);
        return NextResponse.json({ ok: true });
      }
      case 'descricao': {
        const descricao = String(p.valor ?? '');
        if (descricao.length > 2048) return erro('O WhatsApp aceita até 2048 letras na descrição.');
        await mudarDescricaoGrupo(inst, jid, descricao);
        return NextResponse.json({ ok: true });
      }
      case 'foto': {
        const url = String(p.valor ?? '');
        if (!midiaDoSendflow(url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) return erro('Envie a foto pelo SendFlow.');
        await mudarFotoGrupo(inst, jid, url);
        await supabase.from('groups').update({ foto_url: url }).eq('group_id', jid);
        return NextResponse.json({ ok: true });
      }
      case 'so_admins_enviam':
        await mudarRegraGrupo(inst, jid, p.valor === true ? 'announcement' : 'not_announcement');
        return NextResponse.json({ ok: true });
      case 'so_admins_editam':
        await mudarRegraGrupo(inst, jid, p.valor === true ? 'locked' : 'unlocked');
        return NextResponse.json({ ok: true });
      case 'temporarias': {
        const s = Number(p.valor);
        if (!(DURACOES_TEMPORARIAS as readonly number[]).includes(s)) return erro('Duração inválida.');
        await mudarTemporarias(inst, jid, s as DuracaoTemporaria);
        return NextResponse.json({ ok: true });
      }
      case 'participantes': {
        const op = p.operacao as AcaoParticipante;
        if (!['add', 'remove', 'promote', 'demote'].includes(op)) return erro('Operação inválida.');
        const brutos = Array.isArray(p.pessoas) ? p.pessoas.map(String).filter(Boolean) : [];
        if (!brutos.length) return erro('Escolha pelo menos uma pessoa.');
        if (brutos.length > 50) return erro('No máximo 50 pessoas por vez.');
        let pessoas = brutos;
        if (op === 'add') {
          // Adicionar vem de telefone digitado; o resto já vem com o id do WhatsApp.
          const invalidos = brutos.filter((t) => !telefoneValido(t));
          if (invalidos.length) return erro(`Telefone inválido: ${invalidos.slice(0, 3).join(', ')}`);
          pessoas = [...new Set(brutos.map(normalizarTelefoneBR))];
        }
        const resultado = await mudarParticipantes(inst, jid, op, pessoas);
        const recusados = resultado
          .map((r) => ({ jid: r.jid, motivo: explicarStatusParticipante(r.status, op) }))
          .filter((r): r is { jid: string; motivo: string } => r.motivo !== null);
        return NextResponse.json({ ok: true, feitos: resultado.length - recusados.length, recusados });
      }
      case 'link':
        return NextResponse.json({ ok: true, link: await linkDoGrupo(inst, jid) });
      case 'redefinir_link':
        await redefinirLinkDoGrupo(inst, jid);
        return NextResponse.json({ ok: true, link: await linkDoGrupo(inst, jid) });
      case 'sair':
        await sairDoGrupo(inst, jid);
        // Fora do grupo, disparo para ele só daria erro: desativa no SendFlow.
        await supabase.from('groups').update({ ativo: false }).eq('group_id', jid);
        return NextResponse.json({ ok: true });
      default:
        return erro('Ação desconhecida.');
    }
  } catch (e) {
    return respostaDeErro(e);
  }
}
