import { redirect } from 'next/navigation';

export default function Home() {
  // O painel de KPIs virou a porta de entrada: a primeira pergunta de quem abre o
  // sistema é "o que a gente mandou está dando retorno?", não "o que está agendado?".
  redirect('/painel');
}
