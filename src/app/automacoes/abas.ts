// As abas da tela Automações. Fora do componente cliente para a página (servidor)
// conseguir validar o ?aba= da URL.

export const ABAS = [
  { id: 'fluxos', label: 'Fluxos', icone: '🧩' },
  { id: 'basicas', label: 'Respostas básicas', icone: '👋' },
  { id: 'palavras', label: 'Palavras-chave', icone: '🔑' },
  { id: 'links', label: 'Links e anúncios', icone: '🔗' },
  { id: 'webhook', label: 'Webhook / LP', icone: '🪝' },
  { id: 'campos', label: 'Campos', icone: '🏷️' },
] as const;

export type Aba = (typeof ABAS)[number]['id'];
