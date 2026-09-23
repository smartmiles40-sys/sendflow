# Automações (o "ManyChat" do SendFlow)

Só para número da **API oficial da Meta** (Cloud API). Chip por QR Code continua
servindo para grupos e não roda automação.

## O que existe

| ManyChat | SendFlow | Onde |
|---|---|---|
| Connect WhatsApp | **Conectar com a Meta** (Cadastro Incorporado) | Conexões |
| Flow Builder | **Editor de fluxo** visual (blocos + setas) | Automações → abrir fluxo |
| Welcome Message | Gatilho **Boas-vindas** (1ª mensagem da vida da pessoa) | Automações → Respostas básicas |
| Default Reply | Gatilho **Resposta padrão** (com intervalo mínimo) | Automações → Respostas básicas |
| Keywords | Gatilho **Palavra-chave** (contém palavra / exata / começa com) | Automações → Palavras-chave |
| Ref URL / QR | Gatilho **Link de referência** (`wa.me/...?text=... [ref:codigo]`) | Automações → Links |
| Click-to-WhatsApp Ads | Gatilho **Anúncio** (por id do anúncio, ou qualquer um) | Automações → Links |
| External Request / Zapier | Gatilho **Webhook externo** (`POST /api/webhooks/fluxo/<token>`) | Automações → Webhook |
| Tag trigger | Gatilho **Tag adicionada** | Automações → Webhook |
| User Fields | **Campos personalizados** (`{{chave}}`) | Automações → Campos |
| Live Chat | **Conversas** (caixa de entrada, pausar robô, iniciar fluxo) | Conversas |
| Broadcasts | **Campanhas** para contatos (template aprovado) | Campanhas |
| Sequences | Fluxo com blocos **Aguardar** (dias/horas, faixa de horário) | Editor |

### Blocos do editor

- **Mensagem** — texto, imagem, vídeo, áudio, documento; no fim: até 3 **botões**, uma **lista** (até 10 opções) ou um **botão de link**. Cada botão é uma saída.
- **Pergunta** — espera a resposta, valida (texto, número, e-mail, telefone, data) e salva num campo.
- **Template** — o único que sai **fora da janela de 24 h**. Botões de resposta rápida do template viram saídas.
- **Aguardar** — minutos/horas/dias, com faixa de horário opcional (ex.: só 09:00–20:00).
- **Condição** — tag, campo, nome/e-mail, janela aberta, inscrito → Sim / Não.
- **Ações** — pôr/tirar tag, definir/limpar campo, lista, descadastrar, **pausar robô** (passa para humano), avisar a equipe por e-mail, chamar webhook, parar outros fluxos.
- **Teste A/B**, **Ir para outro fluxo**, **Fim**.

### Ordem em que o robô decide (a cada mensagem que chega)

1. Clique num botão de fluxo → segue a seta daquele botão (funciona até em mensagem antiga).
2. Havia pergunta/botões esperando → a resposta vai para lá.
3. Link de referência → 4. Anúncio → 5. Palavra-chave (maior prioridade primeiro)
6. Boas-vindas (só na 1ª mensagem) → 7. Resposta padrão.

Nada roda para quem pediu para sair (PARAR etc.) nem com o robô pausado na conversa.
Responder à mão em **Conversas** pausa o robô por 12 h (dá para desligar).

## A regra das 24 horas

Texto livre, botões e perguntas só saem se a pessoa escreveu nas últimas 24 h. Fora
disso, só **Template**. Por isso:
- fluxo iniciado pelo **webhook da LP** deve começar por um bloco Template;
- toda Mensagem/Pergunta tem a saída **"Janela de 24 h fechada"** para desviar.

## Configurar (uma vez)

### 1. Variáveis na Vercel (projeto `sendflow`)

| Variável | O que é |
|---|---|
| `META_APP_ID` | Id do app da Meta (pode ser o mesmo "Se tu For" do QS: `1702747864137149`) |
| `META_APP_SECRET` | Segredo desse app — é o mesmo que confere a assinatura do webhook |
| `META_WEBHOOK_VERIFY_TOKEN` | Uma senha qualquer que você inventa (a Meta repete ela ao verificar o webhook) |
| `APP_URL` | `https://sendflow-smoky.vercel.app` (já existe) |

`META_ACCESS_TOKEN` virou opcional: número conectado pelo botão tem o próprio token no
cofre (Supabase Vault).

### 2. No app da Meta (developers.facebook.com)

1. **Login do Facebook para Empresas → Configurações → Criar configuração** do tipo
   *Cadastro incorporado do WhatsApp*. Copie o **id** → cole em Conexões → *Ajustes do botão*.
   (Se usar o app do QS, o id já existe: `1067176032691119`.)
2. **Login do Facebook → Configurações**: ligue *Login com o SDK do JavaScript* e adicione
   o domínio `sendflow-smoky.vercel.app` nos domínios permitidos.
3. O app precisa estar **publicado** (Ao vivo) para números de outras pessoas.

### 3. Conectar

Conexões → **Continuar com o Facebook** → escolha a empresa e o número → pronto. Depois
mande um "oi" para o número: o cartão mostra "Última mensagem recebida".

## Por que não quebra o QS

O webhook "do app" é um só por app da Meta. Se o SendFlow trocasse ele, o QS pararia de
receber mensagens na hora. Por isso o botão usa o **override por número**
(`POST /{phone_number_id}` com `webhook_configuration.override_callback_uri`): só o
número conectado no SendFlow passa a avisar o SendFlow. O webhook do app, apontado para o
QS, continua intacto. **Não conecte no SendFlow o mesmo número que o QS usa.**

## Tabelas (migration 0020)

`wa_conversas`, `wa_mensagens`, `fluxos`, `fluxo_gatilhos`, `fluxo_execucoes`,
`fluxo_eventos`, `contact_fields` + colunas novas em `connections` (`segredo_id`,
`modo_meta`, `webhook_apontado_em`, `ultima_entrada_em`) e as funções `sf_*` (só
`service_role`).

O motor (`src/lib/automacao/motor.ts`) roda em três portas: o webhook da Meta (depois do
200, via `after()`), o tick de minuto em minuto (acorda os "Aguardar" e prazos) e as rotas
de iniciar (tela e webhook externo).
