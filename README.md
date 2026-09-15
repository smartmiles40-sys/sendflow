# SendFlow

Disparador de campanhas de **WhatsApp** e **e-mail marketing**, com KPIs de verdade:
quantas mensagens foram entregues, quantas foram lidas, quem respondeu, quem abriu o
e-mail, em qual link clicou e quem pediu para sair.

Feito para uma equipe pequena operar sozinha: conecta o número por QR Code, puxa os
grupos do próprio WhatsApp, importa os contatos de uma planilha e dispara — sem
depender de fornecedor de API paga e sem editar fluxo em ferramenta externa.

---

## O que este sistema faz

**WhatsApp**
- Conecta **vários números** por QR Code (Evolution API), como no WhatsApp Web.
- Puxa a lista de grupos do próprio aparelho — acabou o "cole o ID do grupo".
- Dispara para grupos ou para contatos um a um, com texto, imagem, vídeo ou PDF.
- Espaça os envios com intervalo aleatório por número (anti-bloqueio), respeita um teto
  diário e distribui a carga entre os números conectados.
- Agendamento pontual, sequências de aula e campanhas recorrentes semanais.
- Registra **entrega (✓✓ cinza)**, **leitura (✓✓ azul)** e **resposta** de cada destinatário.

**E-mail marketing**
- Editor com três modelos prontos, prévia isolada e envio de teste.
- Listas, tags, importação de CSV e descadastro em um clique.
- Personalização por contato (`{{primeiro_nome}}`, `{{empresa}}`, colunas livres do CSV).
- Teste **A/B de assunto** com leitura do resultado em português.
- Registra **entrega, abertura, clique, bounce, denúncia de spam e descadastro**.

**Painel**
- Série diária dos dois canais, funil de cada um e ranking dos grupos que mais leem.
- Cada número vem com uma referência de mercado e uma frase dizendo o que fazer quando
  está abaixo dela.

---

## Como funciona por dentro

```
   Navegador
       │
       ▼
  Next.js (App Router)  ──────────────►  Supabase (Postgres + Storage)
       │                                        ▲
       │  motor de envio                        │ fila: 1 linha por destinatário
       │  (src/lib/dispatch)                    │
       ├──────────►  Evolution API  ──►  WhatsApp
       └──────────►  Resend / SMTP   ──►  Caixa de entrada
                          │
   webhooks  ◄────────────┘   entrega, leitura, resposta, bounce, spam
```

### A ideia central: a fila é o estado

Uma campanha não é "um envio". É um **molde** que, na hora marcada, vira **N linhas** —
uma por grupo ou por pessoa. Cada linha tem o próprio estado e os próprios carimbos de
tempo.

Isso resolve três problemas de uma vez:

1. **KPI.** "Taxa de leitura" só existe porque cada destinatário tem um campo `lido_em`.
   Um contador agregado nunca responderia "quais grupos não leram".
2. **Retomada.** O motor é um tick curto, chamado de minuto em minuto. Se ele morrer no
   meio, cair a rede ou sair um deploy, o próximo tick continua exatamente de onde
   parou — porque o estado está no banco, não em memória.
3. **Anti-bloqueio.** O intervalo entre mensagens é persistido por conexão
   (`connections.proximo_envio_em`), então sobrevive entre invocações independentes da
   hospedagem.

O motor **nunca** manda uma mensagem sem antes vencer uma corrida
(`update … where status = 'pendente'`). Dois ticks simultâneos não disparam o mesmo
destinatário duas vezes.

---

## Começar

### 1. Banco

Crie um projeto no [Supabase](https://supabase.com) e rode as migrations de
`supabase/migrations/` **em ordem**, da `0001` à `0012` (SQL Editor, uma de cada vez,
ou via `supabase db push`).

Crie também um bucket público chamado `campanhas-midia` (Storage → New bucket → Public).

### 2. Variáveis de ambiente

```bash
cp .env.example .env.local
```

Preencha. O mínimo para o sistema subir é `NEXT_PUBLIC_SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY`; o resto o próprio sistema cobra na tela **Configurações**,
dizendo o que cada ausência quebra.

Gere os segredos com:

```bash
openssl rand -hex 32   # para AUTH_SECRET, CRON_SECRET e WEBHOOK_SECRET
```

### 3. Rodar

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # 279 testes
npm run lint
```

### 4. Conectar o WhatsApp

Suba uma [Evolution API v2](https://doc.evolution-api.com) (o passo a passo, inclusive
com Docker, está em [`docs/EVOLUTION.md`](docs/EVOLUTION.md)), preencha
`EVOLUTION_API_URL` e `EVOLUTION_API_KEY`, e então:

**Conexões → Conectar número → ler o QR no celular → Puxar grupos.**

Os grupos chegam **desativados**. Ative um a um os que devem receber campanha — assim
uma sincronização nunca vira "agora disparo para 60 grupos que eu não escolhi".

### 5. Configurar o e-mail

Escolha um caminho e siga [`docs/EMAIL.md`](docs/EMAIL.md):

- **Resend** (recomendado): verificar o domínio, `RESEND_API_KEY` e o webhook. É o único
  jeito de ter entrega, bounce e denúncia de spam confirmados pelo provedor.
- **SMTP**: qualquer caixa que a empresa já pague. Abertura e clique continuam
  funcionando (são medidos por nós); "entregue" vira inferência.

### 6. Ligar o relógio

O motor precisa ser acordado de minuto em minuto. Veja
[`docs/DEPLOY.md`](docs/DEPLOY.md) — em resumo: na Vercel com cron por minuto, o
`vercel.json` já resolve; em qualquer outro caso, importe
`n8n/sendflow-tick.workflow.json`.

---

## Documentação

| Arquivo | O que tem |
|---|---|
| [`docs/EVOLUTION.md`](docs/EVOLUTION.md) | Subir a Evolution, conectar números, webhooks, problemas comuns |
| [`docs/EMAIL.md`](docs/EMAIL.md) | Resend x SMTP, verificar domínio, SPF/DKIM/DMARC, entregabilidade |
| [`docs/KPIS.md`](docs/KPIS.md) | O que cada número significa, como é medido e **onde ele mente** |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Subir na Vercel, cron, segredos, checklist de produção |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Modelo de dados, motor de envio, decisões e por quê |
| [`n8n/README.md`](n8n/README.md) | O que saiu do n8n e o workflow que ficou |

---

## Mapa do código

```
src/
  app/
    painel/            Painel de KPIs (porta de entrada)
    campanhas/         WhatsApp: lista, compositor, resultado por destinatário
    email/             E-mail: lista, editor, resultado com A/B e links
    contatos/          Base compartilhada: contatos, listas, importação de CSV
    conexoes/          Números de WhatsApp: QR Code, status, sincronizar grupos
    configuracoes/     Remetente padrão + diagnóstico do ambiente
    api/
      dispatch/tick/   O motor. Chamado pelo cron.
      webhooks/        Evolution (entrega/leitura/resposta) e Resend (bounce/spam)
      e/               Pixel de abertura, clique rastreado e descadastro
  lib/
    whatsapp/          Conector Evolution, endereçamento (JID) e leitura de eventos
    email/             Montagem do e-mail, provedores (Resend/SMTP) e validação
    dispatch/          Fan-out, ritmo anti-bloqueio e os dois workers
    kpis.ts            Cálculo das taxas, referências de mercado e conselhos
  proxy.ts             Login (o `middleware.ts` do Next 16)
supabase/migrations/   O banco, em ordem
```

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind v4 · Supabase · Vitest ·
Evolution API v2 · Resend ou SMTP

## Origem

Este projeto é uma continuação do `inovvatur-flows`, um disparador de WhatsApp para
grupos que rodava em **n8n + Z-API**. O que foi mantido: o modelo de campanhas,
sequências e recorrências, e a identidade visual. O que mudou: o conector, o motor de
envio, a medição, o e-mail marketing e o login. O histórico de commits original está
preservado.
