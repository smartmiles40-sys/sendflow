// As frentes da agência. As chaves também estão no CHECK do banco
// (supabase/migrations/0014_categorias_da_agencia.sql): mudar uma exige mudar a outra.
export const CATEGORIAS = [
  { key: 'lives', label: 'Lives' },
  { key: 'expedicoes', label: 'Expedições' },
  { key: 'comunidade', label: 'Comunidade' },
  { key: 'avulsas', label: 'Avulsas' },
] as const;

export type CategoriaKey = (typeof CATEGORIAS)[number]['key'];

export const CATEGORIA_KEYS: CategoriaKey[] = CATEGORIAS.map((c) => c.key);

export function isCategoria(v: unknown): v is CategoriaKey {
  return typeof v === 'string' && (CATEGORIA_KEYS as string[]).includes(v);
}

export function categoriaLabel(key: string): string {
  return CATEGORIAS.find((c) => c.key === key)?.label ?? key;
}
