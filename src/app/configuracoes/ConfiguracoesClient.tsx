'use client';

import { useState } from 'react';
import { Field, inputCls } from '@/components/ui';

interface Ambiente {
  url_publica: string;
  url_estavel: boolean;
  evolution: boolean;
  email: string | null;
  login: boolean;
  auth_secret: boolean;
  cron_secret: boolean;
  webhook_secret: boolean;
  resend_webhook: boolean;
}

interface Remetente {
  nome: string;
  email: string;
  responder_para: string;
  rodape_endereco: string;
  rodape_texto: string;
}

export function ConfiguracoesClient({
  remetente: inicial,
  ambiente,
}: {
  remetente: Remetente;
  ambiente: Ambiente;
}) {
  const [remetente, setRemetente] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setSalvo(false);
    setErro(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: 'email_remetente', valor: remetente }),
      });
      if (res.ok) setSalvo(true);
      else setErro((await res.json().catch(() => ({}))).error ?? 'Não foi possível salvar.');
    } catch {
      setErro('Sem conexão com o servidor.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.01em]">Configurações</h1>
        <p className="mt-1.5 text-sm text-muted">
          O estado do ambiente e os padrões que valem para todas as campanhas.
        </p>
      </header>

      <Diagnostico ambiente={ambiente} />

      <section className="mb-6 rounded-xl2 border border-border bg-surface p-5">
        <h2 className="mb-1 text-[15px] font-semibold">Remetente padrão dos e-mails</h2>
        <p className="mb-5 text-xs leading-relaxed text-muted">
          Preenchido automaticamente em toda campanha nova. Use sempre o mesmo endereço do domínio
          verificado no provedor — trocar o remetente a cada envio é um dos sinais que mais joga
          e-mail para a caixa de spam.
        </p>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Nome que aparece">
            <input
              value={remetente.nome}
              onChange={(e) => setRemetente({ ...remetente, nome: e.target.value })}
              placeholder="Equipe Inovvatur"
              className={inputCls}
            />
          </Field>
          <Field label="E-mail de envio">
            <input
              value={remetente.email}
              onChange={(e) => setRemetente({ ...remetente, email: e.target.value })}
              placeholder="contato@suaempresa.com.br"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Responder para" hint="(opcional)">
          <input
            value={remetente.responder_para}
            onChange={(e) => setRemetente({ ...remetente, responder_para: e.target.value })}
            placeholder="comercial@suaempresa.com.br"
            className={inputCls}
          />
        </Field>

        <Field
          label="Texto do rodapé"
          hint="explica por que a pessoa está recebendo — reduz marcação de spam"
        >
          <input
            value={remetente.rodape_texto}
            onChange={(e) => setRemetente({ ...remetente, rodape_texto: e.target.value })}
            placeholder="Você recebeu este e-mail porque se cadastrou em um de nossos canais."
            className={inputCls}
          />
        </Field>

        <Field
          label="Endereço no rodapé"
          hint="razão social e endereço — exigência das leis antispam e boa prática de LGPD"
        >
          <input
            value={remetente.rodape_endereco}
            onChange={(e) => setRemetente({ ...remetente, rodape_endereco: e.target.value })}
            placeholder="Empresa LTDA · CNPJ 00.000.000/0001-00 · Rua Exemplo, 100 — São Paulo/SP"
            className={inputCls}
          />
        </Field>

        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando}
            className="rounded-xl bg-blue px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0a54ff] disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          {salvo && <span className="text-sm text-[#7effcf]">✓ Salvo</span>}
          {erro && <span className="text-sm text-[#ffb183]">{erro}</span>}
        </div>
      </section>

      <section className="rounded-xl2 border border-border bg-surface p-5">
        <h2 className="mb-1 text-[15px] font-semibold">O motor de envio</h2>
        <p className="mb-4 text-xs leading-relaxed text-muted">
          As campanhas saem de um motor próprio, dentro deste sistema. Ele precisa ser acordado de
          minuto em minuto por um agendador externo — é isso que faz o horário agendado ser
          respeitado.
        </p>
        <div className="rounded-xl border border-border bg-surface2 p-3.5">
          <code className="block break-all font-mono text-[11px] leading-relaxed text-muted">
            POST {ambiente.url_publica}/api/dispatch/tick
            <br />
            Header: x-cron-secret: {ambiente.cron_secret ? '«o valor de CRON_SECRET»' : '(não configurado)'}
          </code>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Na Vercel, o arquivo <code className="font-mono">vercel.json</code> já agenda isso (planos
          com cron por minuto). Em qualquer outro lugar, um Schedule Trigger do n8n apontando para
          essa URL a cada minuto resolve. O passo a passo está em{' '}
          <code className="font-mono">docs/DEPLOY.md</code>.
        </p>
      </section>
    </div>
  );
}

/**
 * O diagnóstico do ambiente.
 *
 * Existe porque quase todo problema deste tipo de sistema é variável de ambiente
 * faltando, e o sintoma aparece longe da causa: "a campanha não sai" (falta a Evolution),
 * "os KPIs estão zerados" (falta AUTH_SECRET, então nada é assinado), "os links do
 * e-mail quebraram depois do deploy" (falta APP_URL). Uma tela que lista o que falta
 * economiza cada uma dessas caçadas.
 */
function Diagnostico({ ambiente }: { ambiente: Ambiente }) {
  const itens: { ok: boolean; critico: boolean; titulo: string; detalhe: string }[] = [
    {
      ok: ambiente.evolution,
      critico: true,
      titulo: 'Evolution API (WhatsApp)',
      detalhe: ambiente.evolution
        ? 'Configurada. Conecte os números na aba Conexões.'
        : 'Faltam EVOLUTION_API_URL e EVOLUTION_API_KEY. Sem isso, nenhuma campanha de WhatsApp sai.',
    },
    {
      ok: Boolean(ambiente.email),
      critico: true,
      titulo: 'Provedor de e-mail',
      detalhe: ambiente.email
        ? `Usando ${ambiente.email}.`
        : 'Faltam RESEND_API_KEY ou as variáveis SMTP_*. Sem isso, nenhum e-mail sai.',
    },
    {
      ok: ambiente.auth_secret,
      critico: true,
      titulo: 'AUTH_SECRET',
      detalhe: ambiente.auth_secret
        ? 'Definido. É o que assina a sessão do login e os links de clique do e-mail.'
        : 'Não definido. Sem ele, o login não funciona e o rastreamento de cliques fica inativo. Gere com: openssl rand -hex 32',
    },
    {
      ok: ambiente.login,
      critico: true,
      titulo: 'Login',
      detalhe: ambiente.login
        ? 'Ativo. Só quem está em APP_USERS entra.'
        : 'APP_USERS não definido — o painel está ABERTO para qualquer pessoa com o endereço, e daqui se dispara para toda a base.',
    },
    {
      ok: ambiente.url_estavel,
      critico: false,
      titulo: 'APP_URL',
      detalhe: ambiente.url_estavel
        ? `Domínio fixo: ${ambiente.url_publica}`
        : `Usando ${ambiente.url_publica}, que muda a cada deploy. Os links e o pixel de campanhas antigas param de funcionar quando isso muda. Defina APP_URL com o domínio definitivo.`,
    },
    {
      ok: ambiente.cron_secret,
      critico: false,
      titulo: 'CRON_SECRET',
      detalhe: ambiente.cron_secret
        ? 'Definido. Só quem tem o segredo aciona o motor.'
        : 'Não definido: qualquer um que descubra a URL pode acionar o motor de envio.',
    },
    {
      ok: ambiente.webhook_secret,
      critico: false,
      titulo: 'WEBHOOK_SECRET',
      detalhe: ambiente.webhook_secret
        ? 'Definido. O webhook da Evolution só aceita chamadas com o segredo.'
        : 'Não definido: qualquer um pode mandar eventos falsos e sujar os KPIs de entrega e leitura.',
    },
    {
      ok: ambiente.resend_webhook,
      critico: false,
      titulo: 'RESEND_WEBHOOK_SECRET',
      detalhe: ambiente.resend_webhook
        ? 'Definido. Bounce e spam chegam verificados.'
        : 'Opcional, mas sem ele não há confirmação de entrega, bounce nem denúncia de spam vindas do provedor.',
    },
  ];

  const pendentes = itens.filter((i) => !i.ok);

  return (
    <section className="mb-6 overflow-hidden rounded-xl2 border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold">
        Estado do ambiente
        {pendentes.length === 0 ? (
          <span className="ml-2 text-xs font-normal text-[#7effcf]">tudo configurado</span>
        ) : (
          <span className="ml-2 text-xs font-normal text-muted">
            {pendentes.length} item(ns) pendente(s)
          </span>
        )}
      </h2>
      <div className="divide-y divide-border">
        {itens.map((i) => (
          <div key={i.titulo} className="flex items-start gap-3 px-5 py-3">
            <span
              className="mt-0.5 shrink-0 text-sm"
              aria-label={i.ok ? 'configurado' : i.critico ? 'faltando' : 'atenção'}
            >
              {i.ok ? '✅' : i.critico ? '⛔' : '⚠️'}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{i.titulo}</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted">{i.detalhe}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
