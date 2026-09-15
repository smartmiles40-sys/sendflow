import { urlPublica } from '../url';

/**
 * Cutuca o motor para rodar AGORA, sem esperar o próximo minuto do cron.
 *
 * Existe por uma razão de experiência: quem clica em "Enviar agora" espera ver a
 * mensagem sair, não esperar até um minuto olhando para "Agendada". O cron continua
 * sendo a garantia (se esta chamada falhar, o próximo ciclo pega a campanha do mesmo
 * jeito) — isto aqui é só o atalho.
 *
 * Deliberadamente sem `await` no chamador: a resposta ao usuário não pode ficar presa
 * esperando o disparo terminar. Erros são engolidos porque, nesse desenho, "falhou o
 * atalho" significa apenas "vai sair no próximo ciclo".
 */
export function dispararTick(canal: 'whatsapp' | 'email' | 'todos' = 'todos'): void {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  const url = `${urlPublica()}/api/dispatch/tick?canal=${canal}`;
  fetch(url, {
    method: 'POST',
    headers: secret ? { 'x-cron-secret': secret } : {},
    // Sem `keepalive`: em ambiente serverless a função pode ser congelada assim que
    // responde, e a chamada ficaria pela metade. A rede de segurança é o cron.
  }).catch(() => {});
}
