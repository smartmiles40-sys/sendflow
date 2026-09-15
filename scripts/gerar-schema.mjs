// Junta as migrations num único `supabase/schema-completo.sql`.
//
// Por que existe: montar o banco pela primeira vez pelo painel do Supabase significa
// abrir o SQL Editor doze vezes, na ordem certa. Uma ordem trocada quebra de um jeito
// difícil de diagnosticar (uma tabela referencia outra que ainda não existe). Um
// arquivo só transforma isso em um copiar-e-colar.
//
// O arquivo é DERIVADO: quem manda são as migrations. Rode `npm run schema` depois de
// acrescentar uma, senão o consolidado sai do ar em silêncio — e é justamente ele que
// alguém vai usar para montar o banco daqui a seis meses.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PASTA = 'supabase/migrations';
const SAIDA = 'supabase/schema-completo.sql';
const REGUA = '-- ═════════════════════════════════════════════════════════════════════════════';

const CABECALHO = `${REGUA}
-- SendFlow — banco completo, num arquivo só
--
-- COMO USAR
--   1. Crie um projeto no Supabase (supabase.com).
--   2. Abra SQL Editor → New query.
--   3. Cole ESTE arquivo inteiro e clique em Run.
--   4. Storage → New bucket → nome \`campanhas-midia\`, marque **Public**.
--   5. Settings → API → copie a Project URL e a service_role key para o .env.local:
--        NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
--        SUPABASE_SERVICE_ROLE_KEY=...
--   6. Reinicie o \`npm run dev\` (variável de ambiente não recarrega sozinha).
--
-- É o mesmo conteúdo de supabase/migrations/, na ordem, concatenado. Rodar as
-- migrations uma a uma dá exatamente no mesmo — este arquivo é só conveniência.
--
-- Pode rodar de novo com segurança: tudo é \`if not exists\` / \`create or replace\`.
-- Os únicos comandos destrutivos são \`drop trigger\` seguidos de recriação, e o
-- \`drop constraint if exists groups_group_id_key\`, que é intencional (com vários
-- números, o mesmo grupo pode aparecer em dois, então a unicidade correta é o par).
--
-- GERADO AUTOMATICAMENTE — não edite aqui. Mexa nas migrations e gere de novo com:
--   npm run schema
${REGUA}

`;

// Ordem alfabética é a ordem de execução porque os arquivos são numerados (0001, 0002…).
// Se algum dia alguém criar uma migration sem número, ela iria parar no lugar errado —
// daí a checagem abaixo, que falha alto em vez de gerar um arquivo quebrado.
const arquivos = readdirSync(PASTA)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const semNumero = arquivos.filter((f) => !/^\d{4}_/.test(f));
if (semNumero.length) {
  console.error(
    `Migration sem prefixo numérico: ${semNumero.join(', ')}.\n` +
      'A ordem de execução vem do nome do arquivo — renomeie para 00NN_descricao.sql.',
  );
  process.exit(1);
}

const partes = arquivos.map((nome) => {
  const corpo = readFileSync(join(PASTA, nome), 'utf8').trim();
  return `\n${REGUA}\n-- ${nome}\n${REGUA}\n\n${corpo}\n`;
});

writeFileSync(SAIDA, CABECALHO + partes.join(''), 'utf8');
console.log(`${SAIDA} gerado a partir de ${arquivos.length} migrations.`);
