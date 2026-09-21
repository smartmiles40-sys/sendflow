# Evolution só do SendFlow (com "fixar mensagem")

## Por que existe

A Evolution oficial (2.3.7, e também a 2.4.0 em desenvolvimento) **não tem rota para
fixar mensagem**, embora a biblioteca que ela usa por dentro (Baileys 7) saiba fazer isso.
Acrescentamos a rota `POST /chat/pinMessage/{instância}` num fork:

- código: `github.com/smartmiles40-sys/evolution-api`, branch `sendflow-pin`
  (a mudança são 75 linhas em 5 arquivos, commit `2edf00a`);
- imagem: `ghcr.io/smartmiles40-sys/evolution-api:2.3.7-pin` (pública, montada pelo
  GitHub Actions a cada push na branch);
- teste de fumaça: workflow "Teste da imagem (fixar)" liga a imagem com um Postgres
  temporário e confere que a rota existe.

A Evolution do VPS é **compartilhada** com o QS (SDRs, closers, Chatwoot). Para não
arriscar o QS, o SendFlow ganhou **uma Evolution só dele**, no mesmo VPS, na mesma
Postgres (banco separado `evolution_mkt`) e no mesmo domínio, no caminho `/mkt`.

Corpo da rota:

```json
{ "key": { "id": "…", "remoteJid": "…@g.us", "fromMe": false, "participant": "…@lid" },
  "action": "pin", "duration": 604800 }
```

`action`: `pin` | `unpin`. `duration` (só no pin): 86400 (24 h), 604800 (7 dias) ou
2592000 (30 dias).

## 1. Painel Docker da Hostinger (projeto `whatsapp-times` → Compose)

Colar os dois serviços abaixo **dentro de `services:`** (por exemplo logo depois do
serviço `evolution-api`), com a mesma indentação dele:

```yaml
  evolution-mkt-db-init:
    image: pgvector/pgvector:pg16
    restart: "no"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD}
    entrypoint: ["/bin/sh", "-c"]
    command:
      - psql -h postgres -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='evolution_mkt'" | grep -q 1 || psql -h postgres -U postgres -c "CREATE DATABASE evolution_mkt"
    networks:
      - internal

  evolution-mkt:
    image: ghcr.io/smartmiles40-sys/evolution-api:2.3.7-pin
    container_name: wt_evolution_mkt
    restart: unless-stopped
    depends_on:
      evolution-mkt-db-init:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    environment:
      SERVER_URL: https://${EVOLUTION_DOMAIN}/mkt
      AUTHENTICATION_API_KEY: ${AUTHENTICATION_API_KEY}
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: "true"
      LANGUAGE: pt-BR
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/evolution_mkt?schema=public
      DATABASE_CONNECTION_CLIENT_NAME: evolution_mkt
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      DATABASE_SAVE_MESSAGE_UPDATE: "true"
      DATABASE_SAVE_DATA_CONTACTS: "true"
      DATABASE_SAVE_DATA_CHATS: "true"
      DATABASE_SAVE_DATA_LABELS: "true"
      DATABASE_SAVE_DATA_HISTORIC: "true"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://:${REDIS_PASSWORD}@redis:6379/7
      CACHE_REDIS_PREFIX_KEY: evolution_mkt
      CACHE_REDIS_SAVE_INSTANCES: "false"
      CACHE_LOCAL_ENABLED: "false"
      CONFIG_SESSION_PHONE_CLIENT: SendFlow
      CONFIG_SESSION_PHONE_NAME: Chrome
      QRCODE_LIMIT: "30"
      WEBHOOK_GLOBAL_ENABLED: "false"
      CHATWOOT_ENABLED: "false"
    volumes:
      - evolution_mkt_instances:/evolution/instances
    networks:
      - internal
    labels:
      - traefik.enable=true
      - traefik.http.routers.evolution-mkt.rule=Host(`${EVOLUTION_DOMAIN}`) && PathPrefix(`/mkt`)
      - traefik.http.routers.evolution-mkt.entrypoints=${TRAEFIK_ENTRYPOINT}
      - traefik.http.routers.evolution-mkt.tls=true
      - traefik.http.routers.evolution-mkt.tls.certresolver=${TRAEFIK_CERTRESOLVER}
      - traefik.http.routers.evolution-mkt.middlewares=evolution-mkt-strip
      - traefik.http.middlewares.evolution-mkt-strip.stripprefix.prefixes=/mkt
      - traefik.http.services.evolution-mkt.loadbalancer.server.port=8080
```

E, lá embaixo, em `volumes:`, acrescentar uma linha:

```yaml
  evolution_mkt_instances:
```

Salvar e implantar. Os containers que já existem (Evolution do QS, Chatwoot, Postgres,
Redis) **não reiniciam** por causa disso — só nascem os dois novos.

Conferir: abrir `https://<EVOLUTION_DOMAIN>/mkt/` no navegador → tem que aparecer
"Welcome to the Evolution API, it is working!".

## 2. Trocar o SendFlow de servidor (feito pelo Claude, com o Bruno no QR)

1. Na Vercel, `EVOLUTION_API_URL` = `https://<EVOLUTION_DOMAIN>/mkt` (a chave é a
   mesma) e redeploy.
2. SendFlow → Conexões → **Conectar** no número do MKT. Como o número ainda não existe
   no servidor novo, o SendFlow cria com o **mesmo nome** e mostra o QR.
3. Escanear o QR com o celular do MKT (WhatsApp → Aparelhos conectados).
4. Conferir grupos e Celular; depois **apagar a instância antiga do MKT** na Evolution do
   QS (senão os dois servidores mandam os mesmos eventos para o SendFlow).

O que muda para quem usa: o histórico que a tela Celular mostra recomeça do que o
WhatsApp mandar na hora do pareamento (o servidor novo não herda o banco do antigo).
Campanhas, grupos, tags e KPIs ficam no Supabase do SendFlow e não mudam.

## Voltar atrás

Na Vercel, `EVOLUTION_API_URL` de volta para `https://<EVOLUTION_DOMAIN>` e reconectar
o MKT lá. Os dois serviços `evolution-mkt*` podem ser removidos do Compose sem afetar o QS.

## Atualizar a Evolution no futuro

Trazer a versão nova do projeto oficial para a branch `sendflow-pin` do fork, reaplicar
o commit `2edf00a` (se ainda não existir rota de fixar oficial) e dar push: o Actions
publica a imagem nova. Se a Evolution oficial ganhar a rota, volte para a imagem
oficial e ajuste `fixarMensagem()` em `src/lib/whatsapp/evolution.ts`.
