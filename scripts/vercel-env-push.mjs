// Copia as variáveis do .env.local para o projeto "sendflow" na Vercel (Production).
//
// Uso (uma vez só, na raiz do repo):
//   npx vercel login
//   npx vercel link --yes --project sendflow --scope smartmiles40-sys-projects
//   node scripts/vercel-env-push.mjs
//
// - Pula variável vazia (o sistema lista em Configurações o que ainda falta).
// - Pula VERCEL_*: a própria Vercel cria e gerencia (o `vercel link` escreve o
//   VERCEL_OIDC_TOKEN no .env.local).
// - APP_URL: localmente é http://localhost:3000; na Vercel vai FIXA no endereço público
//   (sendflow-smoky.vercel.app). Os endereços *-smartmiles40-sys-projects.vercel.app pedem
//   login da Vercel e bloqueariam pixel, clique, descadastro e webhooks. Ela vai gravada em
//   cada e-mail enviado: troque só antes do primeiro disparo (SENDFLOW_URL=... node ...).
// - Rodar de novo sobrescreve (--force), então serve também para atualizar um valor.
//
// É Node e não bash de propósito: o .env.local salvo no Windows termina as linhas com \r,
// e a versão em bash mandava esse \r junto com o valor.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arquivo = path.join(raiz, '.env.local');
if (!existsSync(arquivo)) {
  console.error('Falta o .env.local');
  process.exit(1);
}

const urlPublica = process.env.SENDFLOW_URL || 'https://sendflow-smoky.vercel.app';

for (const bruta of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
  const linha = bruta.trim();
  if (!linha || linha.startsWith('#') || !linha.includes('=')) continue;

  const chave = linha.slice(0, linha.indexOf('='));
  let valor = linha.slice(linha.indexOf('=') + 1).trim();
  if (chave.startsWith('VERCEL_')) continue;
  if (chave === 'APP_URL') valor = urlPublica;
  if (!valor) {
    console.log(`pulada (vazia): ${chave}`);
    continue;
  }

  execFileSync(
    'npx',
    ['--yes', 'vercel', 'env', 'add', chave, 'production', '--value', valor, '--yes', '--force'],
    { cwd: raiz, stdio: 'ignore', shell: process.platform === 'win32' },
  );
  console.log(`enviada: ${chave}`);
}

console.log('\nPronto. Faça um novo deploy (push na main, ou: npx vercel --prod) para valer.');
