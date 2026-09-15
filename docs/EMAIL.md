# E-mail marketing — configurar e não cair no spam

## Escolher o caminho

| | **Resend** (recomendado) | **SMTP** |
|---|---|---|
| Custo | 3.000 e-mails/mês grátis, depois ~US$ 20/mês | já incluso na caixa que você paga |
| Configuração | verificar o domínio no painel deles | usuário e senha |
| **Entregue** | confirmado pelo provedor (webhook) | inferido: "o servidor aceitou" |
| **Bounce** | sim, e descadastra o contato sozinho | não |
| **Denúncia de spam** | sim, e descadastra o contato sozinho | não |
| Abertura e clique | medidos por nós (pixel + link) | idem |
| Volume | milhares por hora | dezenas por hora, e a caixa pode bloquear |

Os dois adaptadores estão prontos. A escolha é uma variável de ambiente — nenhuma linha
de código muda.

**Resumo honesto:** com SMTP você sabe quem abriu e quem clicou, mas não sabe quem
**não recebeu**. E "não recebeu" é o problema mais caro do e-mail marketing, porque é
invisível: a taxa de abertura cai e ninguém sabe se o assunto ficou ruim ou se metade
da lista está indo para o spam.

---

## Caminho A — Resend

1. Criar conta em [resend.com](https://resend.com).
2. **Domains → Add Domain** → informar `suaempresa.com.br`.
3. Copiar os registros DNS (SPF, DKIM e, opcionalmente, DMARC) para o painel do seu
   domínio. Levam de minutos a algumas horas para propagar.
4. **API Keys → Create** → copiar para `RESEND_API_KEY`.
5. **Webhooks → Add Endpoint**:
   - URL: `https://SEU-DOMINIO/api/webhooks/resend`
   - Eventos: `email.delivered`, `email.bounced`, `email.complained`
   - Copiar o **Signing Secret** (começa com `whsec_`) para `RESEND_WEBHOOK_SECRET`

```env
RESEND_API_KEY=re_xxxxxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxxxxx
EMAIL_PROVIDER=resend
```

> **Não** assine `email.opened` nem `email.clicked`. Abertura e clique já são medidos
> aqui, pelo pixel e pelo link rastreado. Assinar os dois lados contaria cada abertura
> duas vezes — uma métrica com duas fontes é uma métrica em que ninguém confia.

---

## Caminho B — SMTP

```env
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=contato@suaempresa.com.br
SMTP_PASS=a-senha-da-caixa
EMAIL_PROVIDER=smtp
```

Porta **587** (STARTTLS) ou **465** (TLS direto) — o sistema detecta pelo número.

Valores comuns:

| Provedor | Host | Porta |
|---|---|---|
| Hostinger | `smtp.hostinger.com` | 587 |
| Zoho | `smtp.zoho.com` | 587 |
| Gmail / Workspace | `smtp.gmail.com` | 587 (exige **senha de app**) |
| Brevo | `smtp-relay.brevo.com` | 587 |

Atenção ao **limite da caixa**: Gmail pessoal corta em ~500/dia, Workspace em ~2.000.
Estourar não dá erro bonito — a conta é suspensa por 24 h.

---

## Entregabilidade: o que realmente decide

Isto não é opcional. Um e-mail que não chega não tem abertura para medir.

### 1. SPF, DKIM e DMARC no DNS

Sem os três, Gmail e Outlook jogam no spam ou rejeitam. O Resend entrega os registros
prontos; com SMTP, peça-os ao seu provedor de e-mail.

O DMARC mais simples que já ajuda:

```
_dmarc.suaempresa.com.br   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@suaempresa.com.br"
```

### 2. Descadastro em um clique

Já está pronto e ligado: todo e-mail sai com os cabeçalhos `List-Unsubscribe` e
`List-Unsubscribe-Post`, que é o que faz aparecer o botão **Cancelar inscrição** do
próprio Gmail. Desde 2024 isso é **exigência** para quem manda volume — sem ele, a
entrega degrada em silêncio, e o sintoma aparece como "a taxa de abertura caiu".

O rodapé com o link também é injetado automaticamente, mesmo que o modelo não peça.

### 3. Remetente estável

Use sempre o mesmo `De:`, do domínio verificado. Trocar de remetente a cada campanha é
um dos sinais mais fortes de spam. Configure o padrão em **Configurações → Remetente
padrão**.

### 4. Lista limpa

O sistema já faz o essencial sozinho:

- bounce e denúncia de spam **descadastram o contato na hora**;
- quem descadastrou **nunca mais** entra numa fila de envio;
- reimportar a planilha antiga **não** ressuscita ninguém.

O que ele não pode fazer por você: não comprar lista. Uma base comprada queima a
reputação do domínio em uma campanha, e a reputação demora meses para voltar.

### 5. Aquecimento

Domínio novo não manda 5.000 e-mails no primeiro dia. Uma rampa que funciona:

| Dia | Volume |
|---|---|
| 1–3 | 50/dia, para os contatos mais engajados |
| 4–7 | 200/dia |
| 2ª semana | 500/dia |
| 3ª semana | 1.000/dia |
| depois | o volume real |

---

## Escrever a campanha

**E-mail → Nova campanha.**

### Assunto

O campo que mais decide a abertura. O contador embaixo dele avisa o tamanho: acima de
~45 caracteres o celular começa a cortar, e a maioria abre no celular.

### Teste A/B

Marque **Testar dois assuntos**. Metade da lista recebe A, metade B, alternadamente — e
o resultado aparece na tela da campanha. O sistema só declara um vencedor quando a
diferença passa de 3 pontos com pelo menos 50 entregas por variante; abaixo disso ele
diz que foi ruído, porque foi.

### Variáveis

| Variável | Vira |
|---|---|
| `{{nome}}` | nome completo do contato |
| `{{primeiro_nome}}` | só o primeiro nome |
| `{{email}}` | o e-mail dele |
| `{{empresa}}` | a empresa |
| `{{rodape}}` | o rodapé com o link de descadastro |
| qualquer coluna do CSV | `{{cidade}}`, `{{plano}}`… |

Variável sem valor vira **vazio**. Nunca aparece `{{nome}}` na tela de quem recebe.

Valores vindos do contato são escapados antes de entrar no HTML — uma empresa chamada
`Silva & Cia` não quebra a marcação, e um nome importado com HTML dentro não vira HTML.

### Sempre mande um teste antes

O botão está na coluna da direita. O teste vai com `[TESTE]` no assunto e — importante —
**não entra nos números** da campanha: o token do teste não existe na fila, então abrir
o próprio teste dez vezes não move nenhum KPI.

Confira na caixa de entrada de verdade: o assunto, o remetente, se caiu em Promoções, e
se os links funcionam.

---

## Importar contatos

**Contatos e listas → Importar CSV.**

O arquivo precisa de uma linha de cabeçalho e ao menos uma coluna de **e-mail** ou
**telefone**. São reconhecidos automaticamente: `nome`, `e-mail`, `telefone`
(ou `celular`/`whatsapp`), `empresa` e `tags`. Qualquer outra coluna vira variável de
personalização.

A importação tem **prévia**: antes de gravar, o sistema mostra quais colunas entendeu,
quantos contatos são válidos e quais linhas tiveram problema, com o número da linha.

Regras da gravação:

- contato novo é criado; contato que já existe (mesmo e-mail ou telefone) é **atualizado**;
- só os campos **preenchidos no arquivo** sobrescrevem — coluna vazia não apaga o que já estava lá;
- tags são **somadas**, nunca substituídas;
- quem descadastrou **continua descadastrado**.
