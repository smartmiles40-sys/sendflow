import { LoginClient } from './LoginClient';
import { loginExigido, segredoConfigurado } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Entrar · SendFlow' };

export default function LoginPage() {
  // Checado no servidor: a tela precisa explicar por que o login não vai funcionar
  // ANTES de a pessoa digitar a senha e receber um erro genérico.
  return <LoginClient configurado={loginExigido() && segredoConfigurado()} />;
}
