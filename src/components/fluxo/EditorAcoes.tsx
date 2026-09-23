'use client';

import { inputCls } from '@/components/ui';
import type { Acao, DadosAcao } from '@/lib/automacao/tipos';
import { labelCls, Numero, perigoBtn, Secao, Selecao, TextoVar } from './campos';
import type { Recursos } from './recursos';

const TIPOS: { v: Acao['tipo']; rotulo: string; dica: string }[] = [
  { v: 'adicionar_tag', rotulo: '🏷️ Adicionar tag', dica: 'Marca o contato. Tags podem disparar outros fluxos.' },
  { v: 'remover_tag', rotulo: '🏷️ Remover tag', dica: '' },
  { v: 'definir_campo', rotulo: '✏️ Preencher campo', dica: 'Aceita variáveis: {{primeiro_nome}}.' },
  { v: 'limpar_campo', rotulo: '🧹 Limpar campo', dica: '' },
  { v: 'adicionar_lista', rotulo: '📋 Colocar numa lista', dica: 'As listas servem de público nas campanhas.' },
  { v: 'remover_lista', rotulo: '📋 Tirar de uma lista', dica: '' },
  { v: 'pausar_automacao', rotulo: '🙋 Pausar o robô (passar para humano)', dica: 'Nenhum fluxo responde esta pessoa até acabar a pausa.' },
  { v: 'notificar_equipe', rotulo: '📧 Avisar a equipe por e-mail', dica: 'Precisa do remetente de e-mail configurado.' },
  { v: 'webhook', rotulo: '🔗 Chamar webhook (n8n, Bitrix…)', dica: 'Manda os dados do contato em JSON por POST.' },
  { v: 'parar_outros_fluxos', rotulo: '⛔ Parar outros fluxos desta pessoa', dica: 'Cancela sequências e esperas em andamento.' },
  { v: 'descadastrar', rotulo: '🚫 Descadastrar do WhatsApp', dica: 'A pessoa para de receber campanhas e fluxos.' },
  { v: 'reinscrever', rotulo: '✅ Reinscrever no WhatsApp', dica: 'Só use se a pessoa pediu para voltar.' },
];

function nova(tipo: Acao['tipo']): Acao {
  switch (tipo) {
    case 'adicionar_tag':
    case 'remover_tag':
      return { tipo, tag: '' };
    case 'definir_campo':
      return { tipo, chave: '', valor: '' };
    case 'limpar_campo':
      return { tipo, chave: '' };
    case 'adicionar_lista':
    case 'remover_lista':
      return { tipo, listaId: '' };
    case 'pausar_automacao':
      return { tipo, horas: 24 };
    case 'notificar_equipe':
      return { tipo, email: '', mensagem: '{{nome}} precisa de atenção no WhatsApp.' };
    case 'webhook':
      return { tipo, url: 'https://' };
    default:
      return { tipo } as Acao;
  }
}

function CampoSelect({ valor, onChange, rec }: { valor: string; onChange: (v: string) => void; rec: Recursos }) {
  return (
    <Selecao valor={valor} onChange={onChange} rotulo="Campo">
      <option value="">Escolha o campo…</option>
      <option value="nome">Nome do contato</option>
      <option value="email">E-mail do contato</option>
      {rec.campos.map((c) => (
        <option key={c.chave} value={c.chave}>
          {c.rotulo} ({c.chave})
        </option>
      ))}
    </Selecao>
  );
}

function Formulario({ a, mudar, rec }: { a: Acao; mudar: (a: Acao) => void; rec: Recursos }) {
  switch (a.tipo) {
    case 'adicionar_tag':
    case 'remover_tag':
      return (
        <input value={a.tag} onChange={(e) => mudar({ ...a, tag: e.target.value })} placeholder="ex.: interesse-japao" className={`${inputCls} py-2`} />
      );
    case 'definir_campo':
      return (
        <>
          <CampoSelect valor={a.chave} onChange={(chave) => mudar({ ...a, chave })} rec={rec} />
          <div className="mt-2">
            <TextoVar valor={a.valor} onChange={(valor) => mudar({ ...a, valor })} max={1000} linhas={1} variaveis={rec.campos} placeholder="valor" />
          </div>
        </>
      );
    case 'limpar_campo':
      return <CampoSelect valor={a.chave} onChange={(chave) => mudar({ ...a, chave })} rec={rec} />;
    case 'adicionar_lista':
    case 'remover_lista':
      return (
        <Selecao valor={a.listaId} onChange={(listaId) => mudar({ ...a, listaId })} rotulo="Lista">
          <option value="">{rec.listas.length ? 'Escolha a lista…' : 'Nenhuma lista criada (Contatos e listas)'}</option>
          {rec.listas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome}
            </option>
          ))}
        </Selecao>
      );
    case 'pausar_automacao':
      return (
        <div className="flex items-center gap-2">
          <Numero valor={a.horas} min={1} max={720} onChange={(horas) => mudar({ ...a, horas: Math.max(1, horas) })} className="w-24" />
          <span className="text-[13px] text-muted">horas</span>
        </div>
      );
    case 'notificar_equipe':
      return (
        <>
          <label className={labelCls}>E-mail de quem recebe</label>
          <input
            type="email"
            value={a.email}
            onChange={(e) => mudar({ ...a, email: e.target.value.trim() })}
            placeholder="comercial@…"
            className={`${inputCls} mb-2 py-2`}
          />
          <TextoVar rotulo="Mensagem" valor={a.mensagem} onChange={(mensagem) => mudar({ ...a, mensagem })} max={1000} linhas={2} variaveis={rec.campos} />
        </>
      );
    case 'webhook':
      return (
        <input value={a.url} onChange={(e) => mudar({ ...a, url: e.target.value.trim() })} placeholder="https://n8n…/webhook/…" className={`${inputCls} py-2`} />
      );
    default:
      return null;
  }
}

export function EditorAcoes({ dados, mudar, rec }: { dados: DadosAcao; mudar: (d: DadosAcao) => void; rec: Recursos }) {
  const d = dados;
  return (
    <Secao titulo="Ações" dica="Rodam em sequência, sem a pessoa ver nada. Depois, o fluxo segue.">
      <div className="flex flex-col gap-2">
        {d.acoes.map((a, i) => {
          const t = TIPOS.find((x) => x.v === a.tipo);
          return (
            <div key={i} className="rounded-xl border border-border bg-surface2/60 p-2.5">
              <div className="mb-2 flex items-center gap-1">
                <span className="flex-1 text-[12px] font-semibold text-ink">{t?.rotulo}</span>
                <button type="button" className={perigoBtn} onClick={() => mudar({ acoes: d.acoes.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
              <Formulario a={a} mudar={(na) => mudar({ acoes: d.acoes.map((x, j) => (j === i ? na : x)) })} rec={rec} />
              {t?.dica && <p className="mt-1.5 text-[11px] text-muted">{t.dica}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <Selecao
          valor=""
          onChange={(v) => v && mudar({ acoes: [...d.acoes, nova(v as Acao['tipo'])] })}
          rotulo="Adicionar ação"
        >
          <option value="">+ Adicionar ação…</option>
          {TIPOS.map((t) => (
            <option key={t.v} value={t.v}>
              {t.rotulo}
            </option>
          ))}
        </Selecao>
      </div>
    </Secao>
  );
}
