import '@testing-library/jest-dom/vitest';

// Segredo fixo nos testes: `seguranca.ts` recusa assinar sem AUTH_SECRET (de propósito,
// para nunca assinar com string vazia em produção). Fixar aqui torna as assinaturas
// determinísticas, o que é o que permite testar login e link de clique.
process.env.AUTH_SECRET ??= 'segredo-de-teste-determinístico-0123456789';
