# Arquitetura

Este documento registra **as decisões e os porquês** — o que um `git log` não conta.

---

## O que mudou em relação ao sistema original

O projeto veio de um disparador que rodava em **n8n + Z-API**. A mudança não foi trocar
de fornecedor; foi mudar onde mora a lógica.

| | Antes | Agora |
|---|---|---|
| Conector | Z-API (pago por mensagem) | Evolution API (self-hosted) |
| Números | um, token numa credencial do n8n | vários, conectados por QR na tela |
| Motor | workflow longo no n8n | tick curto e idempotente no próprio app |
| Estado do envio | 3 contadores em `campaigns.resultado` | 1 linha por destinatário |
| Medição | nenhuma | entrega, leitura, resposta, abertura, clique, bounce, spam |
| Canais | WhatsApp | WhatsApp + e-mail, sobre a mesma base de contatos |
| Acesso | **nenhum** — aberto na internet | login com sessão assinada |
| Testes | 100 | 279 |

### Por que tirar o motor do n8n

Não foi por preferência de ferramenta. Três problemas concretos:

1. **Não dava para medir.** O sub-workflow chamava o Z-API e seguia em frente. Não havia
   onde guardar "esta mensagem, para este grupo, foi entregue às 09:01 e lida às 09:14".
   Sem isso, não existe taxa de leitura.
2. **Não dava para retomar.** Um fluxo longo que morre no meio não sabe onde parou.
3. **Não dava para testar.** A regra de negócio vivia em nós de código dentro de uma
   interface web, sem versionamento e sem teste. O guia `SUB-changes.md` existia para
   ensinar a equipe a **colar código à mão** em dois nós.

O n8n continua útil — como **relógio** (`n8n/sendflow-tick.workflow.json`). O que saiu
de lá foi a maquinaria.

---

## Modelo de dados

```
connections ──< groups
     │
     └──< campaign_recipients >── campaigns
                  │
                  └── contacts ──< list_members >── lists
                        │
                        └──< email_recipients >── email_campaigns
                                    │
                                    └──< email_events
```

### A decisão central: a fila é o estado

`campaign_recipients` e `email_recipients` têm **uma linha por destinatário**, com
status próprio e carimbos de tempo próprios.

O que isso compra:

- **KPI.** "Taxa de leitura" é uma contagem sobre `lido_em`.
- **Retomada.** O motor pode ser interrompido a qualquer instante.
- **Diagnóstico.** "Quem não recebeu" tem resposta com nome e motivo, não um contador.
- **Concorrência.** A corrida pelo direito de enviar é um `update` com guarda de status.

### Contatos são compartilhados pelos dois canais

Não existe "contato de e-mail" e "contato de WhatsApp". É a mesma pessoa, com
`status_email` e `status_whatsapp` separados — sair de um canal não tira do outro.

É o que permite perguntar "quem abriu o e-mail **e** leu o WhatsApp"
(`vw_contato_engajamento`).

### Índices sem predicado, de propósito

`contacts.email`, `contacts.telefone` e `email_recipients (campaign_id, email)` são
índices únicos **simples**, sem `where` e sem `lower()`. Não é descuido: o PostgREST só
resolve `ON CONFLICT` contra índice sem predicado. Com `where email is not null`, o
upsert da importação de CSV falharia com *"no unique constraint matching"*.

O preço é que a normalização (minúsculas, sem espaço) tem de ser feita na aplicação —
e é, em `normalizarEmail()`, em todo caminho que escreve contato.

---

## O motor de envio

`POST /api/dispatch/tick` — chamado de minuto em minuto. Cada tick:

1. **Promove** campanhas cuja hora chegou → monta a fila (fan-out).
2. **Recupera órfãs**: linhas presas em `enviando` há mais de 15 min voltam para a fila.
3. **Drena**, uma conexão de cada vez, em paralelo entre conexões.
4. **Fecha** as campanhas que não têm mais nada pendente.
5. **Materializa** as recorrentes, se passaram 6 h desde a última vez.

Tudo dentro de um **orçamento de 45 s** (abaixo do teto de 60 s da hospedagem). Ser
cortado no meio não corrompe nada — o estado está na fila.

### As três garantias

**1. Nunca envia duas vezes.**

```ts
update campaign_recipients set status='enviando'
 where id = ? and status = 'pendente'   -- devolve linha só para quem chegou primeiro
```

**2. O intervalo anti-bloqueio sobrevive entre invocações.**

Cada tick é um processo novo, sem memória do anterior. Por isso o "quando esta conexão
pode enviar de novo" é **estado no banco** (`connections.proximo_envio_em`), e não um
`sleep` em memória.

**3. Nada fica preso para sempre.**

Linha em `enviando` há mais de 15 min: se tem `provider_message_id`, a mensagem saiu e
só não foi anotada — vira `enviado`. Se não tem, volta para a fila (até 3 tentativas).

### Paralelismo entre números, nunca dentro de um

Conexões drenam com `Promise.all`. Dentro de uma conexão, o envio é estritamente
sequencial com intervalo — é justamente o intervalo que protege contra bloqueio.

### Por que o fan-out prefere a conexão do GRUPO

Um grupo só pode ser alcançado pelo número que participa dele. Daí a precedência
`grupo → campanha → padrão`, que como efeito colateral distribui a carga entre os
números sem ninguém configurar nada.

---

## Onde nascem os KPIs

### WhatsApp: `/api/webhooks/evolution`

Duas regras governam esse endpoint:

1. **Responder rápido e sempre 200.** A Evolution reenvia o que falha; um endpoint lento
   vira uma fila crescente de retentativas. Erro nosso é engolido — o custo de perder um
   ACK é um KPI defasado; o de travar o webhook é a ingestão inteira parar.
2. **Nada pesado no caminho.** Uma consulta por índice e um update.

O funil **só anda para a frente**: ACKs chegam fora de ordem com frequência (READ antes
de DELIVERY_ACK, ou repetidos). Sem essa guarda, "lido" viraria "entregue" e a taxa de
leitura oscilaria para baixo sozinha.

### E-mail: pixel, link e webhook

- **Abertura**: `/api/e/o/<token>.png` — imagem de 1×1, sem cache em nenhuma camada.
- **Clique**: `/api/e/c/<token>?u=<destino>&s=<assinatura>` — conta e redireciona.
- **Descadastro**: `/api/e/u/<token>` — GET (link do rodapé) e POST (botão do Gmail).
- **Entrega, bounce e spam**: `/api/webhooks/resend`, com assinatura Svix verificada.

Os contadores sobem dentro de **funções SQL** (`0012_eventos_email.sql`), não com
read-modify-write na aplicação: duas aberturas simultâneas leriam `aberturas = 3`,
gravariam 4 as duas, e uma sumiria.

### Por que o link de clique é assinado

Sem HMAC, `/api/e/c/x?u=<site-falso>` seria um **redirecionador aberto** partindo do
nosso domínio — o presente perfeito para phishing, e o domínio queimado seria o nosso.
Um clique não contado é um KPI impreciso; um redirecionador aberto é um incidente.

---

## Segurança

| Camada | O quê |
|---|---|
| Painel | `src/proxy.ts` — sessão em cookie HttpOnly assinado com HMAC |
| Motor | `CRON_SECRET` |
| Webhook Evolution | segredo na URL (a Evolution não permite cabeçalho), comparado em tempo constante |
| Webhook Resend | assinatura Svix + janela de 5 min contra replay |
| Link de clique | HMAC sobre `token + destino` |
| Banco | RLS ligado sem policy; só a `service_role` (servidor) lê |
| Funções SQL | `EXECUTE` revogado de `anon` e `authenticated` |
| Prévia do e-mail | `<iframe sandbox="">` — HTML colado nunca roda no painel |
| Dados do contato no HTML | escapados em `personalizar()` |

**Por que os usuários ficam em variável de ambiente.** É uma ferramenta interna de
poucas pessoas. Uma tabela de usuários com hash, recuperação de senha e papéis seria
mais cerimônia do que proteção: quem lê a variável de ambiente do servidor já tem a
chave do banco. O que protege é a variável nunca sair do painel da hospedagem.

---

## Fusos

`America/Sao_Paulo` é tratado como **UTC−03:00 fixo** — o Brasil não tem horário de
verão desde 2019. Essa premissa já existia no projeto original (`format.ts`,
`sequence.ts`, `recurrence.ts`) e foi mantida por consistência.

Onde importa: limite diário por conexão, série diária do painel e nome das ocorrências
recorrentes. Contar em UTC jogaria tudo que sai depois das 21h para o dia seguinte.

---

## O que NÃO foi feito, e por quê

- **Editor de e-mail de arrastar-e-soltar.** Custa semanas e engessa o resultado.
  Três modelos testados + edição de HTML resolvem o caso real.
- **Chatwoot como conector.** Chatwoot é caixa de atendimento, não motor de disparo:
  não manda para grupos em massa e não devolve ACK por destinatário. Escolhê-lo
  significaria abrir mão dos KPIs de entrega e leitura. A camada de conector está
  isolada em `src/lib/whatsapp/`, então uma ponte futura não reescreve nada.
- **Fila com Redis/BullMQ.** O Postgres já dá atomicidade e durabilidade. Um serviço a
  mais para manter, sem ganho no volume deste sistema.
- **Multiempresa.** Nenhuma tabela tem `org_id`. Acrescentar depois é uma migration e
  um filtro; acrescentar agora seria complexidade sem cliente.
