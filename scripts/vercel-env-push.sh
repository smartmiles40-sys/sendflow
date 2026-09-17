#!/usr/bin/env bash
# Copia as variáveis do .env.local para o projeto "sendflow" na Vercel (Production).
#
# Uso (uma vez só, na raiz do repo):
#   npx vercel login
#   npx vercel link --yes --project sendflow --scope smartmiles40-sys-projects
#   bash scripts/vercel-env-push.sh
#
# - Pula variável vazia (o sistema lista em Configurações o que ainda falta).
# - APP_URL: localmente é http://localhost:3000; na Vercel vai FIXA no endereço público
#   (sendflow-smoky.vercel.app). Os endereços *-smartmiles40-sys-projects.vercel.app pedem
#   login da Vercel e bloqueariam pixel, clique, descadastro e webhooks. Ela vai gravada em
#   cada e-mail enviado: troque só antes do primeiro disparo (SENDFLOW_URL=... bash ...).
# - Rodar de novo sobrescreve (--force), então serve também para atualizar um valor.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] || { echo "Falta o .env.local"; exit 1; }

while IFS= read -r linha || [ -n "$linha" ]; do
  case "$linha" in ''|\#*) continue ;; esac
  chave="${linha%%=*}"
  valor="${linha#*=}"
  [ "$chave" = "APP_URL" ] && valor="${SENDFLOW_URL:-https://sendflow-smoky.vercel.app}"
  [ -z "$valor" ] && { echo "pulada (vazia): $chave"; continue; }
  printf '%s' "$valor" | npx --yes vercel env add "$chave" production --force >/dev/null
  echo "enviada: $chave"
done < .env.local

echo
echo "Pronto. Faça um novo deploy (push na main, ou: npx vercel --prod) para valer."
