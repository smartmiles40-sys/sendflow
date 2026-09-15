import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { readJson } from '@/lib/http';
import { lerCsvDeContatos, separarTags, unirTags, type ContatoImportado } from '@/lib/contatos';
import type { Contact } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Blocos de gravação. 300 é o ponto em que a URL do `in()` ainda não fica grande demais. */
const BLOCO = 300;

/**
 * Importa contatos de um CSV colado ou de um arquivo.
 *
 * Semântica da importação, escrita aqui porque é o que gera dúvida depois:
 *   • Contato NOVO é criado.
 *   • Contato que já existe (mesmo e-mail ou mesmo telefone) é ATUALIZADO, e só nos
 *     campos que vieram preenchidos no arquivo — uma coluna vazia não apaga o que já
 *     estava lá. Uma importação parcial nunca destrói cadastro bom.
 *   • Tags são SOMADAS, nunca substituídas. Importar a planilha "clientes-2026" não
 *     pode tirar a tag "vip" de quem já tinha.
 *   • Quem descadastrou continua descadastrado. Reimportar a lista antiga não
 *     ressuscita ninguém — seria a forma mais fácil de furar o opt-out sem perceber.
 */
export async function POST(req: Request) {
  const parsed = await readJson<{
    csv?: unknown;
    list_ids?: unknown;
    tags?: unknown;
    origem?: unknown;
  }>(req);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const csv = String(body.csv ?? '');
  if (!csv.trim()) {
    return NextResponse.json({ errors: [{ field: 'csv', message: 'Cole o conteúdo do arquivo.' }] }, { status: 400 });
  }

  const leitura = lerCsvDeContatos(csv);
  if (!leitura.contatos.length) {
    return NextResponse.json(
      {
        error:
          leitura.total === 0
            ? 'O arquivo não tem linhas de dados (só o cabeçalho, ou está vazio).'
            : 'Nenhuma linha aproveitável: verifique se existe uma coluna de e-mail ou de telefone.',
        ignoradas: leitura.ignoradas.slice(0, 50),
        colunasReconhecidas: leitura.colunas,
      },
      { status: 400 },
    );
  }

  const tagsExtras = Array.isArray(body.tags)
    ? separarTags((body.tags as string[]).join(','))
    : separarTags(String(body.tags ?? ''));
  const listIds = Array.isArray(body.list_ids) ? (body.list_ids as string[]) : [];
  const origem = String(body.origem ?? 'importacao-csv');

  const supabase = createServerClient();
  let criados = 0;
  let atualizados = 0;
  const idsAfetados: string[] = [];
  const falhas: { linha: number; motivo: string }[] = [];

  for (let i = 0; i < leitura.contatos.length; i += BLOCO) {
    const bloco = leitura.contatos.slice(i, i + BLOCO);
    const existentes = await buscarExistentes(supabase, bloco);

    const paraInserir: Record<string, unknown>[] = [];
    const paraAtualizar: { id: string; patch: Record<string, unknown> }[] = [];

    for (const c of bloco) {
      const atual =
        (c.email ? existentes.porEmail.get(c.email) : undefined) ??
        (c.telefone ? existentes.porTelefone.get(c.telefone) : undefined);

      if (atual) {
        const patch: Record<string, unknown> = {
          tags: unirTags(atual.tags, c.tags, tagsExtras),
        };
        // Só sobrescreve o que veio preenchido no arquivo.
        if (c.nome) patch.nome = c.nome;
        if (c.empresa) patch.empresa = c.empresa;
        if (c.email && !atual.email) patch.email = c.email;
        if (c.telefone && !atual.telefone) patch.telefone = c.telefone;
        if (Object.keys(c.campos).length) {
          patch.campos = { ...(atual.campos ?? {}), ...c.campos };
        }
        paraAtualizar.push({ id: atual.id, patch });
        idsAfetados.push(atual.id);
      } else {
        paraInserir.push({
          nome: c.nome,
          email: c.email,
          telefone: c.telefone,
          empresa: c.empresa,
          tags: unirTags(c.tags, tagsExtras),
          campos: c.campos,
          origem,
        });
      }
    }

    if (paraInserir.length) {
      const { data, error } = await supabase.from('contacts').insert(paraInserir).select('id');
      if (error) {
        falhas.push({ linha: 0, motivo: `Bloco não gravado: ${error.message}` });
      } else {
        criados += data?.length ?? 0;
        idsAfetados.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
      }
    }

    // Um update por contato porque cada um tem um patch diferente (as tags mescladas
    // dependem do que aquele contato já tinha). Em bloco de 300 isso é aceitável; se a
    // base crescer para dezenas de milhares por importação, vira uma função no banco.
    for (const item of paraAtualizar) {
      const { error } = await supabase.from('contacts').update(item.patch).eq('id', item.id);
      if (error) falhas.push({ linha: 0, motivo: `${item.id}: ${error.message}` });
      else atualizados += 1;
    }
  }

  // Vincula todo mundo do arquivo às listas escolhidas.
  let vinculados = 0;
  if (listIds.length && idsAfetados.length) {
    for (let i = 0; i < idsAfetados.length; i += BLOCO) {
      const linhas = idsAfetados
        .slice(i, i + BLOCO)
        .flatMap((contact_id) => listIds.map((list_id) => ({ list_id, contact_id })));
      const { error } = await supabase
        .from('list_members')
        .upsert(linhas, { onConflict: 'list_id,contact_id', ignoreDuplicates: true });
      if (!error) vinculados += linhas.length;
    }
  }

  return NextResponse.json({
    criados,
    atualizados,
    vinculados,
    ignoradas: leitura.ignoradas.slice(0, 50),
    totalIgnoradas: leitura.ignoradas.length,
    totalLinhas: leitura.total,
    colunasReconhecidas: leitura.colunas,
    falhas: falhas.slice(0, 20),
  });
}

/** Busca, em duas consultas, quem do bloco já existe — por e-mail e por telefone. */
async function buscarExistentes(
  supabase: ReturnType<typeof createServerClient>,
  bloco: ContatoImportado[],
) {
  const emails = bloco.map((c) => c.email).filter((e): e is string => Boolean(e));
  const telefones = bloco.map((c) => c.telefone).filter((t): t is string => Boolean(t));

  const porEmail = new Map<string, Contact>();
  const porTelefone = new Map<string, Contact>();

  if (emails.length) {
    const { data } = await supabase.from('contacts').select('*').in('email', emails);
    for (const c of (data ?? []) as Contact[]) if (c.email) porEmail.set(c.email, c);
  }
  if (telefones.length) {
    const { data } = await supabase.from('contacts').select('*').in('telefone', telefones);
    for (const c of (data ?? []) as Contact[]) if (c.telefone) porTelefone.set(c.telefone, c);
  }

  return { porEmail, porTelefone };
}

/**
 * Prévia da importação: lê o arquivo e diz o que entendeu, sem gravar nada.
 * Serve para a tela mostrar "reconheci estas colunas, 412 contatos, 3 linhas com
 * problema" ANTES de a pessoa confirmar.
 */
export async function PUT(req: Request) {
  const parsed = await readJson<{ csv?: unknown }>(req);
  if (!parsed.ok) return parsed.res;
  const leitura = lerCsvDeContatos(String(parsed.data.csv ?? ''));
  return NextResponse.json({
    total: leitura.total,
    validos: leitura.contatos.length,
    ignoradas: leitura.ignoradas.slice(0, 50),
    totalIgnoradas: leitura.ignoradas.length,
    colunas: leitura.colunas,
    amostra: leitura.contatos.slice(0, 5),
  });
}
