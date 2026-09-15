'use client';

import { useEffect, useState } from 'react';

/**
 * Um "agora" que a tela pode usar durante a renderização.
 *
 * Chamar `Date.now()` dentro de um `useMemo` parece inofensivo, mas quebra a regra de
 * pureza do React: o resultado muda sem que nenhuma dependência tenha mudado, então o
 * mesmo estado pode renderizar coisas diferentes — e com o Compiler ligado o valor
 * pode congelar em algo antigo sem aviso.
 *
 * Aqui o tempo vira estado de verdade: o valor inicial é fixado uma vez e um timer o
 * atualiza no intervalo pedido. Para os usos deste projeto (marcar qual passo de uma
 * sequência já venceu), um minuto é resolução de sobra.
 */
export function useRelogio(intervaloMs = 60_000): number {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(timer);
  }, [intervaloMs]);

  return agora;
}
