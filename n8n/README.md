# n8n — o que sobrou (e o que saiu)

## O que saiu

Este projeto nasceu com o motor de envio **dentro do n8n**: um dispatcher lia as
campanhas do Supabase, resolvia os grupos e chamava um sub-workflow que falava com o
**Z-API**. Eram quatro arquivos aqui — três workflows e um guia de como editar o
sub-workflow à mão.

Todos foram removidos. O motor agora vive no próprio sistema
(`src/lib/dispatch/`), fala com a **Evolution API** e guarda a fila no banco, uma linha
por destinatário. O que se ganhou com a mudança:

| Antes (n8n + Z-API) | Agora (motor próprio + Evolution) |
|---|---|
| Um número só, token numa credencial do n8n | Vários números, conectados por QR na tela |
| ID de grupo colado à mão, um por um | Grupos puxados do próprio WhatsApp |
| Resultado = 3 contadores (`total/enviados/falhas`) | Uma linha por destinatário, com hora de entrega e de leitura |
| Sem entrega, sem leitura, sem resposta | ✓✓ cinza, ✓✓ azul e resposta viram KPI |
| Fluxo longo que, se caísse, ninguém sabia onde parou | Tick curto e idempotente, retoma sozinho |
| Editar envio = abrir o n8n e mexer em nó de código | Editar envio = mexer em código versionado, com teste |

## O que ficou

Um workflow só: **`sendflow-tick.workflow.json`**.

Ele não envia nada — só **acorda o motor** de minuto em minuto. Toda a lógica está no
sistema; o n8n aqui é relógio, não maquinário.

### Quando usar

- **Não use** se o seu plano na Vercel tem cron por minuto: o `vercel.json` já faz isso.
- **Use** se estiver em plano cujo cron roda uma vez por dia (o agendamento por horário
  simplesmente não funcionaria), ou se hospedar o sistema em qualquer outro lugar.

### Como instalar

1. No n8n: **Workflows → Import from File** → escolha `sendflow-tick.workflow.json`.
2. Abra o nó **Config** e preencha:
   - `appUrl` — a mesma URL que está em `APP_URL`, sem barra no fim.
   - `cronSecret` — o mesmo valor de `CRON_SECRET`.
3. **Ative** o workflow.

### Por que ele chama o motor duas vezes

O motor trabalha por no máximo 45 segundos e devolve `restante` — quantas mensagens
ainda estão na fila. Quando sobra fila, o workflow chama de novo na hora, em vez de
esperar o próximo minuto. Numa campanha para 60 grupos isso é a diferença entre
terminar em 10 minutos e terminar em uma hora.

Se um tick falhar, nada se perde: o estado inteiro está na fila, no banco, e o próximo
minuto continua de onde parou.

### Como saber se está funcionando

Abra **Painel** no sistema. Se houver campanha na fila e o número de mensagens pendentes
não cair de um minuto para o outro, o relógio parou — confira se o workflow está ativo e
se o `cronSecret` bate com o `CRON_SECRET` do ambiente.
