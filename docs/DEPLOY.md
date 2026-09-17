# Deploy

## 1. Banco (Supabase)

1. Criar um projeto em [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → colar **`supabase/schema-completo.sql`** inteiro e
   rodar. São as 14 migrations concatenadas na ordem certa, num paste só.
   (Alternativa: rodar `supabase/migrations/` uma a uma, da `0001_init.sql` à
   `0014_categorias_da_agencia.sql`. Ordem trocada quebra de um jeito difícil de diagnosticar,
   porque uma tabela referencia outra que ainda não existe.)
3. **Storage → New bucket** → nome `campanhas-midia`, marcar **Public**.
4. **Settings → API** → copiar a **Project URL** e a **service_role key**.

> A `service_role` ignora RLS. Ela só existe no servidor — nunca vai para o navegador.
> As tabelas têm RLS **ligado e sem policy**, então a chave pública (`anon`) não lê nada.

## 2. Vercel

```bash
npm i -g vercel
vercel link
```

Ou pelo painel: **Add New → Project → importar `smartmiles40-sys/sendflow`**.

### Variáveis de ambiente

Cole todas as de `.env.example` em **Settings → Environment Variables**, em
**Production** e **Preview**.

Gere os três segredos:

```bash
openssl rand -hex 32   # AUTH_SECRET
openssl rand -hex 32   # CRON_SECRET
openssl rand -hex 32   # WEBHOOK_SECRET
```

**`APP_URL` merece atenção.** Ela vai embutida no pixel e em cada link de **cada e-mail
enviado**. Se mudar depois, as campanhas já enviadas ficam com links quebrados — e não
há conserto, o e-mail já está na caixa das pessoas. Defina o domínio definitivo **antes**
do primeiro envio.

## 3. O relógio

O motor precisa ser acordado de minuto em minuto.

### Opção A — Vercel Cron

O `vercel.json` já está pronto:

```json
{ "crons": [{ "path": "/api/dispatch/tick", "schedule": "* * * * *" }] }
```

Cron por minuto exige plano pago. **No plano gratuito o cron roda uma vez por dia** —
o que torna o agendamento por horário inútil. Nesse caso, use a opção B.

### Opção B — n8n (funciona em qualquer plano)

Importe `n8n/sendflow-tick.workflow.json`, preencha `appUrl` e `cronSecret` no nó
**Config** e ative. Ele ainda tem uma vantagem sobre o cron da Vercel: quando sobra fila,
chama o motor de novo na hora em vez de esperar o próximo minuto.

Detalhes em [`n8n/README.md`](../n8n/README.md).

### Conferir se está rodando

```bash
curl -X POST https://SEU-DOMINIO/api/dispatch/tick \
  -H "x-cron-secret: SEU_CRON_SECRET"
```

Resposta esperada:

```json
{ "ok": true, "duracao_ms": 120, "restante": 0,
  "whatsapp": { "promovidas": 0, "enviadas": 0, ... },
  "email": { ... }, "recorrentes": { "rodou": false, "criadas": 0 } }
```

## 4. Evolution API

Precisa de um servidor próprio — não roda na Vercel. Passo a passo com Docker em
[`docs/EVOLUTION.md`](EVOLUTION.md).

## 5. Webhook do Resend

**Resend → Webhooks → Add Endpoint** → `https://SEU-DOMINIO/api/webhooks/resend`,
eventos `email.delivered`, `email.bounced`, `email.complained`. Copiar o **Signing
Secret** para `RESEND_WEBHOOK_SECRET`.

---

## Checklist antes do primeiro disparo

- [ ] O banco foi montado (`schema-completo.sql`, ou as 14 migrations em ordem)
- [ ] Bucket `campanhas-midia` criado e **público**
- [ ] `APP_URL` com o domínio definitivo
- [ ] `AUTH_SECRET` e `APP_USERS` definidos — **sem eles o painel fica aberto na internet**
- [ ] `CRON_SECRET` definido e o relógio batendo (testar com o `curl` acima)
- [ ] `WEBHOOK_SECRET` definido
- [ ] Pelo menos um número conectado em **Conexões**, com os grupos puxados
- [ ] Os grupos que devem receber estão **ativos** (eles chegam desativados)
- [ ] Domínio de e-mail verificado, com SPF e DKIM no DNS
- [ ] Webhook do Resend configurado
- [ ] Remetente padrão preenchido em **Configurações**, com endereço no rodapé
- [ ] **Configurações → Estado do ambiente** sem nenhum item vermelho
- [ ] Um e-mail de teste recebido e conferido na caixa de entrada
- [ ] Uma campanha de WhatsApp para **um grupo de teste**, conferindo se o ✓✓ azul
      aparece no painel

---

## Manutenção

**Backup.** O Supabase faz backup diário automático nos planos pagos. No gratuito, vale
um `pg_dump` semanal — o que dói perder é a base de contatos e o histórico de KPIs.

**Limpeza.** `email_events` é a tabela que mais cresce (uma linha por abertura e por
clique). Depois de um ano de uso vale arquivar o que for mais antigo que 12 meses:

```sql
delete from email_events where criado_em < now() - interval '12 months';
```

Os KPIs por campanha **não** dependem dela (moram em `email_recipients`); o que se perde
é o ranking de links das campanhas antigas.

**Atualizar.** `npm test && npm run lint && npm run build` antes de subir. O deploy é
por push na `main`.

---

## Quando algo para

| Sintoma | Primeiro lugar para olhar |
|---|---|
| Campanha fica "Agendada" e não sai | O relógio: testar o `curl` do tick |
| Campanha fica "Enviando" e não anda | **Conexões** — número desconectado ou limite diário atingido |
| Entrega e leitura em 0% | Webhook da Evolution: gerar um QR novo, que reaponta a URL |
| E-mail não sai | **Configurações → Estado do ambiente**; provedor sem configurar |
| Links do e-mail quebrados | `APP_URL` mudou depois do envio |
| Login não funciona | `AUTH_SECRET` ausente ou menor que 16 caracteres |
| Tudo parece certo e nada funciona | **Configurações → Estado do ambiente** lista o que falta e o que cada ausência quebra |
