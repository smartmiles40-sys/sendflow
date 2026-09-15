import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Sem isto, o Turbopack sobe procurando o package-lock.json e pode achar um que
  // esteja ACIMA do repositório (na pasta do usuário, por exemplo) — e aí resolve as
  // dependências a partir do lugar errado. Fixar a raiz no próprio projeto encerra
  // o aviso e a ambiguidade.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
