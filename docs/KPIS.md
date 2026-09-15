# KPIs — o que cada número significa, e onde ele mente

Este documento existe porque um painel de marketing só tem valor se a equipe souber
**em que grau confiar em cada número**. Métrica sem contexto leva a decisão errada com
a mesma confiança de uma métrica boa.

---

## WhatsApp

O funil, em ordem:

```
Enviadas  →  Entregues  →  Lidas  →  Responderam
```

| Métrica | Como é medida | Confiança |
|---|---|---|
| **Enviadas** | A Evolution aceitou a mensagem e devolveu um id | Exata |
| **Entregues** | Chegou o ACK `DELIVERY_ACK` — o ✓✓ cinza | Alta |
| **Lidas** | Chegou o ACK `READ` — o ✓✓ azul | **Depende** (ver abaixo) |
| **Responderam** | O contato mandou mensagem para o número em até 7 dias | Alta, mas é atribuição |

### Onde "lidas" mente

Quem **desliga a confirmação de leitura** no WhatsApp nunca gera o ✓✓ azul. Em grupo,
o WhatsApp só reporta leitura em algumas configurações. Ou seja: **o número real de
leituras é sempre maior ou igual ao medido.**

Use como **tendência e comparação** — "o grupo A lê 3× mais que o grupo B" é uma
conclusão sólida. "42% da minha base leu" não é.

### Onde "responderam" é aproximação

A resposta é creditada à **última mensagem enviada àquele destino nos últimos 7 dias**.
Se duas campanhas saíram para o mesmo grupo na mesma semana, a resposta vai para a mais
recente. É a atribuição honesta possível sem ler o conteúdo da conversa.

A janela de 7 dias existe para não creditar uma conversa de hoje a uma campanha do mês
passado.

### Referências

| Métrica | Ruim | Ok | Bom |
|---|---|---|---|
| Entrega | < 85% | 95% | > 98% |
| Leitura | < 40% | 60% | > 80% |
| Resposta | < 1% | 3% | > 8% |

Entrega abaixo de 85% quase sempre é número inválido na lista ou conexão instável —
comece pela aba **Conexões**.

---

## E-mail

```
Enviados  →  Entregues  →  Abertos  →  Clicaram
```

| Métrica | Como é medida | Confiança |
|---|---|---|
| **Enviados** | O provedor aceitou | Exata |
| **Entregues** | Webhook `email.delivered` (só com Resend) | Alta com Resend; inferida com SMTP |
| **Abertos** | Uma imagem de 1×1 foi carregada | **Baixa** (ver abaixo) |
| **Clicaram** | Alguém passou por um link rastreado | **Alta — é o número que vale** |
| **Bounce** | Webhook do provedor | Exata (com Resend) |
| **Spam** | Webhook do provedor | Exata (com Resend) |

### Por que "abertura" é a métrica mais enganosa do e-mail marketing

A abertura é medida por um pixel: uma imagem invisível no fim do e-mail. Se o cliente de
e-mail carregar a imagem, contamos. Três coisas quebram isso:

1. **Imagens bloqueadas.** Outlook bloqueia por padrão; muita gente também no celular.
   Essas aberturas **nunca são contadas** → o número real é **maior**.
2. **Proteção de Privacidade do Mail da Apple.** Desde 2021, o iPhone pré-carrega
   **todas** as imagens de **todos** os e-mails, tenha a pessoa aberto ou não. Para
   quem usa iPhone, a abertura vira praticamente 100% → o número é **menor** do que
   parece.
3. **Proxy do Gmail.** Busca a imagem pelo servidor deles, às vezes antes de a pessoa
   abrir.

Os erros vão nos dois sentidos e não se cancelam de forma previsível.

**A regra prática:** compare a abertura **da sua própria campanha anterior**, com a
mesma lista. Comparar com benchmark de mercado, ou entre listas diferentes, é comparar
dois vieses distintos.

**Clique é o número confiável.** Ninguém clica por acidente, e nenhum proxy clica.
Quando as duas métricas discordam, acredite no clique.

### CTOR — o diagnóstico que a taxa de clique esconde

**CTOR = clicaram ÷ abriram.**

É o número que separa dois problemas que a taxa de clique confunde:

- **Abertura baixa + CTOR alto** → o assunto é fraco. Quem abriu gostou. Teste assuntos.
- **Abertura alta + CTOR baixo** → o assunto promete o que o e-mail não entrega. Mexa
  no conteúdo e na chamada para ação.

### Referências

| Métrica | Ruim | Ok | Bom |
|---|---|---|---|
| Abertura | < 15% | 25% | > 35% |
| Clique | < 1,5% | 2,5% | > 5% |
| CTOR | < 6% | 10% | > 15% |
| Bounce | > 5% | < 2% | < 0,5% |
| Spam | > 0,3% | < 0,1% | < 0,02% |

**Spam é o número mais importante desta tabela.** Acima de 0,3%, Gmail e Outlook passam
a tratar o domínio inteiro com desconfiança — e isso afeta até o e-mail comum da
empresa, não só a campanha.

---

## Convenções do painel

- **Percentuais são 0–100 com uma casa**, vírgula decimal.
- **`—` não é zero.** Travessão significa "não há base para calcular" (ninguém recebeu
  ainda). Zero por cento significa "recebeu e ninguém reagiu". Uma campanha recém-
  disparada mostrando 0% assustaria sem necessidade.
- **Os totais são cumulativos.** Quem foi *lido* também foi *entregue* e *enviado*. Se
  contássemos só o estado final, a taxa de entrega cairia toda vez que alguém lesse.
- **Tempos são medianas, não médias.** Um destinatário com o celular desligado por 8
  horas destruiria a média; a mediana ignora.
- **O resumo do painel é a soma da série do gráfico.** É o que impede o clássico "o card
  diz 1.240 e o gráfico soma 1.190".
- **O dia é o dia em São Paulo.** Contar em UTC jogaria tudo que sai depois das 21h para
  o dia seguinte.

---

## Onde a conta é feita

Nas **visões** de `supabase/migrations/0010_kpis.sql`, não no front-end. Assim o painel,
uma exportação para planilha e qualquer consulta futura leem o mesmo número, e ninguém
recalcula "taxa de abertura" de um jeito diferente em dois lugares.

| Visão | Responde |
|---|---|
| `vw_campaign_kpis` | como foi cada campanha de WhatsApp |
| `vw_destino_kpis` | quais grupos leem o que a gente manda |
| `vw_email_kpis` | como foi cada campanha de e-mail |
| `vw_email_ab` | qual assunto ganhou |
| `vw_email_links` | o que exatamente chamou a atenção |
| `vw_contato_engajamento` | quem está quente agora, nos dois canais |
| `vw_kpis_diarios` | a série do gráfico |

### A nota de engajamento

`vw_contato_engajamento` dá a cada contato uma nota de 0 a 100:

```
abriu e-mail        × 2
clicou no e-mail    × 4
leu no WhatsApp     × 2
respondeu WhatsApp  × 5
```

Os pesos são deliberados: **clicar e responder são atos**; abrir e ler são sinais mais
fracos. A nota satura em 100 de propósito — ela serve para ordenar quem falar primeiro,
não para ranking fino.

---

## As perguntas que o painel responde

| Pergunta | Onde |
|---|---|
| O que a gente mandou está dando retorno? | Painel → funis e "Agiram" |
| Qual grupo não lê nada? | Painel → **Grupos que menos leem** |
| Quem exatamente não recebeu, e por quê? | Campanha → **Quem não recebeu** |
| Qual assunto funciona melhor com esta lista? | Campanha de e-mail → **Teste A/B** |
| O que interessou de verdade? | Campanha de e-mail → **Links mais clicados** |
| Qual o melhor horário para disparar? | Campanha → **Tempo até ler** (mediana) |
| Quem o comercial deve ligar hoje? | Campanha de e-mail → **Quem mais se interessou** |
| A base está queimando? | Painel → bounce e spam nas últimas campanhas |
