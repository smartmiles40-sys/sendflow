import type { GroupTag } from '@/lib/types';

/**
 * Selo de uma tag. A cor vem da tag e entra só na bolinha e numa borda suave: o texto
 * fica sempre claro, então qualquer cor da paleta continua legível no fundo escuro.
 */
export function TagChip({
  tag,
  contagem,
  ativo,
  onClick,
  pequeno = false,
  titulo,
}: {
  tag: Pick<GroupTag, 'nome' | 'cor'>;
  contagem?: number;
  /** Em filtro: a tag está escolhida. */
  ativo?: boolean;
  onClick?: () => void;
  pequeno?: boolean;
  titulo?: string;
}) {
  const conteudo = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tag.cor }} aria-hidden="true" />
      <span className="truncate">{tag.nome}</span>
      {typeof contagem === 'number' && <span className="opacity-60">{contagem}</span>}
    </>
  );
  const cls = `inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border ${
    pequeno ? 'px-2 py-0.5 text-[11.5px]' : 'px-3 py-1 text-[12.5px]'
  } font-medium transition-colors`;
  const estilo = {
    borderColor: ativo ? tag.cor : `${tag.cor}55`,
    background: ativo ? `${tag.cor}2e` : `${tag.cor}12`,
    color: 'var(--color-ink)',
  };
  if (!onClick) {
    return (
      <span className={cls} style={estilo} title={titulo}>
        {conteudo}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className={cls} style={estilo} title={titulo}>
      {conteudo}
    </button>
  );
}
