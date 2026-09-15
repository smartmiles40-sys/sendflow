/**
 * O PostgREST corta TODA resposta em 1000 linhas e não avisa: não vem erro, não vem
 * flag, a lista simplesmente chega menor do que é. Numa base de 3 mil contatos isso
 * seria uma campanha que sai para 1000 pessoas e "funcionou".
 *
 * `.limit(2000)` não resolve — o teto é do servidor. O único jeito é paginar por
 * `.range()`, e é isso que esta função faz: puxa de 1000 em 1000 até a página vir
 * incompleta.
 *
 * A consulta passada precisa ter uma ordenação estável (ordene por uma coluna única,
 * ou desempate pela chave primária). Sem ordem determinística, duas páginas podem
 * repetir e pular linhas.
 */
export async function paginar<T>(
  construir: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanhoPagina = 1000,
): Promise<{ data: T[]; error: string | null }> {
  const tudo: T[] = [];
  for (let pagina = 0; ; pagina++) {
    const de = pagina * tamanhoPagina;
    const { data, error } = await construir(de, de + tamanhoPagina - 1);
    if (error) return { data: tudo, error: error.message };
    const lote = data ?? [];
    tudo.push(...lote);
    if (lote.length < tamanhoPagina) return { data: tudo, error: null };
    // Trava de segurança: 200 páginas = 200 mil linhas. Se chegou aqui, a consulta
    // está errada (sem filtro) e continuar só derrubaria a função por timeout.
    if (pagina > 200) return { data: tudo, error: 'Paginação passou de 200 mil linhas.' };
  }
}
