# Evolution API — conectar os números de WhatsApp

A Evolution API é o que substituiu o Z-API. Ela roda **no seu servidor**, conecta
números por QR Code igual ao WhatsApp Web e não cobra por mensagem.

> **Versão:** este projeto fala com a **Evolution API v2.x**. A v1 usa outro formato de
> corpo nas rotas `/message/*` e não vai funcionar.

---

## 1. Subir a Evolution

Num VPS com Docker (Hostinger, Contabo, DigitalOcean — qualquer um com 2 GB de RAM dá
conta de alguns números):

```bash
mkdir -p ~/evolution && cd ~/evolution

cat > docker-compose.yml <<'YAML'
services:
  evolution:
    image: atendai/evolution-api:v2.2.3
    restart: always
    ports:
      - "8080:8080"
    environment:
      # A chave GLOBAL do servidor. É ela que vai em EVOLUTION_API_KEY no SendFlow.
      AUTHENTICATION_API_KEY: TROQUE_POR_UMA_CHAVE_LONGA_E_ALEATORIA
      # Sessões guardadas em disco: sem isso, reiniciar o container derruba os números
      # e todo mundo tem que ler o QR de novo.
      CACHE_REDIS_ENABLED: "false"
      CACHE_LOCAL_ENABLED: "true"
      DEL_INSTANCE: "false"
      QRCODE_LIMIT: "30"
      LOG_LEVEL: "ERROR"
    volumes:
      - evolution_instances:/evolution/instances
volumes:
  evolution_instances:
YAML

docker compose up -d
```

Gere a chave com `openssl rand -hex 32`.

Confira se subiu:

```bash
curl -H "apikey: SUA_CHAVE" http://localhost:8080/instance/fetchInstances
```

### Coloque atrás de HTTPS

A Evolution **precisa** estar acessível pela internet por HTTPS — é ela quem vai chamar
o webhook do SendFlow, e é o SendFlow que vai chamar as rotas dela. Um Nginx com
Certbot, ou um Caddy de três linhas, resolve:

```
evolution.suaempresa.com.br {
    reverse_proxy localhost:8080
}
```

---

## 2. Ligar no SendFlow

No `.env.local` (e no painel da hospedagem):

```env
EVOLUTION_API_URL=https://evolution.suaempresa.com.br
EVOLUTION_API_KEY=a-chave-do-AUTHENTICATION_API_KEY
WEBHOOK_SECRET=outro-valor-aleatorio
```

`WEBHOOK_SECRET` viaja na URL do webhook. A Evolution não permite configurar cabeçalho
no webhook, então a própria URL é a credencial — por isso ela nunca aparece na interface
nem é gravada no banco. **Sem ele, qualquer um pode mandar eventos falsos** e sujar as
taxas de entrega e leitura.

---

## 3. Conectar um número

**Conexões → dar um nome → Conectar número.**

O QR aparece na hora. No celular:

1. WhatsApp → **Configurações → Aparelhos conectados**
2. **Conectar um aparelho**
3. Apontar a câmera para o código

O código se renova sozinho a cada 30 segundos (o do WhatsApp expira em ~40 s), então não
precisa recarregar a página. Assim que o celular confirmar, clique em **Já li o código**.

### Depois de conectar: puxar os grupos

Clique em **Puxar grupos**. O sistema lista todos os grupos de que aquele número
participa e cadastra os que faltavam.

Três regras da sincronização:

- Grupo novo entra **desativado**. Você liga um a um os que devem receber campanha.
- Grupo que já existia tem só o nome e a contagem de participantes atualizados — o
  "ativo/inativo" é sua escolha e nunca é mexido.
- Grupo que sumiu do WhatsApp (saíram, foi apagado) é **desativado**, nunca apagado: o
  histórico de campanhas aponta para ele.

---

## 4. Vários números

Cada conexão é um número. Vale a pena ter mais de um por dois motivos:

- **Alcance.** Um grupo só pode ser alcançado pelo número que participa dele. Com dois
  números em grupos diferentes, o sistema resolve isso sozinho: no fan-out, a conexão
  do **grupo** ganha da conexão escolhida na campanha.
- **Ritmo.** Números disparam **em paralelo**, cada um no seu intervalo. Dois números
  entregam uma campanha grande em metade do tempo, sem acelerar nenhum deles
  individualmente (o que é justamente o que causaria bloqueio).

### Intervalo e limite diário

Na tela de Conexões, cada número tem:

- **Intervalo mínimo e máximo** (padrão 8–15 s): o tempo de espera, sorteado a cada
  mensagem. Sorteado, e não fixo, porque cadência perfeitamente regular é um dos sinais
  mais óbvios de automação.
- **Limite diário** (padrão 500): teto de mensagens entre 00:00 e 23:59 no horário de
  São Paulo. `0` desliga o teto.

Número novo, recém-criado, merece um começo mais conservador: 15–30 s e 150/dia na
primeira semana.

---

## 5. Os webhooks (onde nascem os KPIs)

O SendFlow registra o webhook sozinho — na criação da conexão e a cada QR novo. Se a URL
do sistema mudar (domínio novo, projeto novo na Vercel), basta **gerar um QR de novo**
que o apontamento se conserta.

Eventos assinados e o que cada um vira:

| Evento da Evolution | Vira |
|---|---|
| `MESSAGES_UPDATE` | ✓✓ cinza (**entregue**) e ✓✓ azul (**lido**) |
| `MESSAGES_UPSERT` | **resposta** do contato |
| `CONNECTION_UPDATE` | status do número na tela de Conexões |
| `QRCODE_UPDATED` | QR novo |

Para conferir manualmente o que está configurado:

```bash
curl -H "apikey: SUA_CHAVE" \
  https://evolution.suaempresa.com.br/webhook/find/NOME_DA_INSTANCIA
```

---

## 6. Quando dá errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Evolution API não configurada" | Faltam as variáveis | Preencher `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` e **refazer o deploy** |
| "A Evolution não respondeu em 20s" | Servidor fora do ar ou URL errada | `curl` na URL; conferir se tem `https://` e se **não** tem barra no fim |
| 401 ao criar conexão | Chave errada | A chave é o `AUTHENTICATION_API_KEY`, não a chave de uma instância |
| QR não aparece | Limite de QR estourado | Reiniciar o container; subir `QRCODE_LIMIT` |
| Conecta e cai sozinho | Volume não persistido | Conferir o `volumes:` do compose — sem ele, a sessão morre a cada restart |
| Campanha fica "Enviando" e nada sai | O relógio parou | Conferir o cron (`docs/DEPLOY.md`); a tela de Configurações mostra a URL do motor |
| Entrega e leitura em 0% | Webhook não chega | Gerar um QR de novo (reaponta o webhook); conferir se a URL pública está acessível de fora |
| Grupo some da lista depois de sincronizar | O número saiu do grupo | O sistema desativa em vez de apagar — é isso mesmo |
| "Destino inválido" numa falha | ID de grupo digitado à mão, errado | Usar **Puxar grupos** em vez de colar ID |

### O número foi bloqueado. E agora?

Bloqueio do WhatsApp não é aleatório — os gatilhos são volume alto em conta nova,
cadência regular demais, e principalmente **denúncia de quem recebe**. O sistema
protege dos dois primeiros. Do terceiro, só o conteúdo protege:

- Não mandar para quem não pediu.
- Não mandar a mesma coisa todo dia.
- Olhar o ranking de **grupos que menos leem** no painel e cortar os grupos mortos —
  mensagem ignorada em volume é exatamente o padrão que o WhatsApp penaliza.
