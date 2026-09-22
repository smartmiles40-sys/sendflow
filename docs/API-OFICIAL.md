# Disparo em massa pela API oficial do WhatsApp

Este é o caminho do **disparo em massa** no SendFlow. Ele é uma **regra do sistema**, não
uma opção de configuração:

> **Campanha para CONTATOS (1 a 1, em massa) só sai pela API oficial da Meta.
> Campanha para GRUPOS só sai por chip (Evolution).**

A regra está gravada em três lugares, de propósito: na tela (o seletor de número já vem
filtrado pelo alvo), na API (`validarCanal`) e no banco (trigger `trg_campaigns_api_oficial`,
migration `0019`). Quem escrever direto no Postgres também não escapa.

---

## Por que a regra existe

Não é preferência de fornecedor. É o que foi medido:

| | Chip (Evolution) | API oficial (Cloud API) |
|---|---|---|
| Como conecta | QR Code, igual ao WhatsApp Web | número registrado no Business Manager |
| Envia para grupo | **sim** | **não** — a Meta não expõe grupos |
| Primeira mensagem | texto livre | **template aprovado** |
| Ritmo | 8–15 s entre mensagens | dezenas por segundo |
| Teto prático | ~500/dia antes do bloqueio | milhares/dia, conforme o tier |
| Entregue / lido | por destinatário (não vem em grupo) | por destinatário, confiável |
| Risco | restrição de 24 h por "bulk messaging" | punição por conteúdo, não por volume |

Os chips dos SDRs da agência já levaram bloqueio de 24 h exatamente por mandar primeira
mensagem em volume. A aprovação prévia do template é o que troca "risco de banimento"
por "mensagem autorizada".

---

## Passo a passo

### 1. Criar o número na Meta

1. <https://business.facebook.com> → **Configurações do negócio → Contas → Contas do WhatsApp**.
2. Crie (ou selecione) a conta do WhatsApp Business — é a **WABA**.
3. Em **Números de telefone**, adicione o chip novo de marketing e conclua a verificação
   por SMS ou ligação.

> Use um número **exclusivo de marketing**. Se a Meta restringir esse número, o
> atendimento do time continua funcionando no dele.

> Um número que já está no app do WhatsApp precisa ser removido de lá antes — a Cloud API
> e o aplicativo não convivem no mesmo número.

### 2. Pegar as credenciais

No painel do app (**Meta for Developers → seu app → WhatsApp → Configuração da API**):

| O que | Onde | Vai para |
|---|---|---|
| **Phone number ID** | ao lado do número, só dígitos | campo na tela **Conexões** |
| **WhatsApp Business Account ID** (WABA) | na mesma tela | campo na tela **Conexões** |
| **Token permanente** | Business Manager → Usuários do sistema → Gerar token | `META_ACCESS_TOKEN` |
| **App secret** | Configurações básicas do app | `META_APP_SECRET` |

O token precisa das permissões `whatsapp_business_messaging` e `whatsapp_business_management`.

> **Não use o token de teste** que aparece na tela de configuração: ele expira em 24 h, e
> a campanha para no meio com erro 190.

> O token e o app secret ficam em **variável de ambiente**, nunca no banco — a mesma regra
> da `EVOLUTION_API_KEY`. O banco guarda só o `phone_number_id`, que sozinho não dá acesso
> a nada.

### 3. Variáveis de ambiente

```
META_ACCESS_TOKEN=EAAG…
META_APP_SECRET=…
META_WEBHOOK_VERIFY_TOKEN=uma-frase-que-voce-inventa
```

Na Vercel: `node scripts/vercel-env-push.mjs` depois de preencher o `.env.local`.

### 4. Cadastrar o webhook

No app da Meta → **WhatsApp → Configuração → Webhooks → Editar**:

- **URL de callback:** `https://SEU-DOMINIO/api/webhooks/meta`
- **Token de verificação:** o mesmo `META_WEBHOOK_VERIFY_TOKEN`
- **Campos assinados:** marque **`messages`** (traz os dois: status de entrega e mensagens
  recebidas).

Sem este passo:

- **entregue e lido ficam em zero para sempre**, e o painel mostra 0% de leitura — que é
  indistinguível de "ninguém leu";
- o **"PARAR" não descadastra ninguém**, e é justamente a denúncia de quem não consegue
  sair que derruba a qualidade do número.

> O endpoint **falha fechado**: sem `META_APP_SECRET` ele responde 503 e não aceita nada.
> Um webhook de WhatsApp aberto permite forjar entregas e descadastrar a base inteira.

### 5. Cadastrar o número no SendFlow

**Conexões → tipo "API oficial" →** nome, Phone number ID, WABA ID, ritmo → **Cadastrar**.

O sistema confere o ID contra a Meta **antes de gravar**. Um ID errado dá erro aqui, e não
20 mil linhas de fila falhando uma a uma daqui a três dias.

### 6. Sincronizar os templates

**Conexões → o número → Templates → Buscar na Meta.**

Os templates são **criados e aprovados no Business Manager**, não aqui. O SendFlow guarda
uma cópia local para o compositor mostrar o texto real e contar as variáveis sem uma ida à
Graph API a cada tecla.

Refaça a sincronização de vez em quando: um template `APPROVED` vira `PAUSED` sozinho do
lado da Meta depois de muita denúncia, e continuar disparando um template pausado joga a
campanha inteira no erro 132015.

---

## Montar uma campanha em massa

**Campanhas → Nova → "Massa 1 a 1 · API oficial"**.

1. Escolha as **listas de contatos**.
2. Escolha o **número oficial** (só eles aparecem).
3. Escolha o **template aprovado**.
4. Preencha **cada lacuna** do template. As lacunas aceitam texto fixo e os mesmos
   marcadores do e-mail: `{{primeiro_nome}}`, `{{nome}}`, `{{empresa}}` e qualquer coluna
   livre do CSV.
5. Confira a prévia ("Como a Maria vai receber") e agende.

**Deixar uma lacuna em branco derruba a campanha inteira** (erro 132000 da Meta, por
destinatário). Por isso a tela cobra todas antes de deixar agendar.

---

## Quanto sai por hora

O motor trabalha em lotes paralelos, com `msgs_por_segundo` por número (padrão 10) e o
tick de minuto em minuto:

- 10 msg/s × ~45 s de orçamento ≈ **450 por tick**
- ≈ **27 mil por hora**, por número

Uma campanha de 50 mil leva pouco menos de duas horas. Para ir mais rápido, suba o ritmo
na conexão (até 80 msg/s) — respeitando o tier do seu número na Meta.

O **fan-out é em fatias**: a fila de 50 mil é montada de mil em mil, com o cursor gravado a
cada página. Um tick cortado no meio retoma de onde parou.

---

## Opt-out: o "PARAR"

Quando alguém responde **PARAR** (ou sair, cancelar, descadastrar, stop, "não quero"…):

1. o contato vira `descadastrado` e ganha o carimbo `optout_whatsapp_em`;
2. **o que ainda não saiu para essa pessoa é cancelado na fila** — o opt-out vale para a
   campanha em andamento, não só para a próxima.

A comparação é sobre a mensagem inteira e curta. "PARAR" descadastra; *"não quero perder a
data, me manda o link"* não — descadastrar alguém animado é pior do que deixar passar um
pedido que a pessoa repete.

---

## Quando algo dá errado

| Código da Meta | O que significa | O motor faz |
|---|---|---|
| 131026 | o número não tem WhatsApp | desiste dessa linha |
| 131047 | passaram 24 h desde a última resposta | desiste — só template resolve |
| 132000 | número de variáveis não bate | desiste (a tela deveria ter barrado) |
| 132001 | template não existe nesse idioma | desiste |
| 132015 / 132016 | template pausado / desabilitado | desiste |
| 130429 | limite de ritmo | **espera e continua** |
| 131048 | suspeita de spam | **derruba a conexão** e para |
| 190 | token expirado ou revogado | derruba a conexão |

O código cru fica em `campaign_recipients.codigo_erro`. Sem ele, "falha" vira adivinhação.

**Qualidade do número** (Conexões → Conferir na Meta): `GREEN` é saúde, `YELLOW` é aviso,
`RED` significa que o teto diário já caiu e a restrição é a próxima etapa. O vigia manda
e-mail quando isso acontece — configure o destinatário em **Configurações → Janela de envio
e vigia**.

---

## O que continua no chip

- **Grupos.** A Meta não envia para grupo, e não há sinal de que vá enviar.
- **A tela Celular.** Ler conversas, responder, reagir, fixar: tudo isso é aparelho.
- **Enquete.** Não existe na API oficial.

Ver [EVOLUTION.md](./EVOLUTION.md) e [EVOLUTION-FIXAR.md](./EVOLUTION-FIXAR.md).
