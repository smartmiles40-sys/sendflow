import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'SendFlow · Se Tu For, Eu Vou!',
  description: 'Campanhas de WhatsApp e e-mail da Se Tu For, Eu Vou! Viagens.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full font-sans antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          {/* pt-16 no celular abre espaço para o cabeçalho fixo com o botão de menu. */}
          <main className="min-w-0 flex-1 overflow-auto px-4 pb-8 pt-16 md:px-9 md:py-[30px]">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
