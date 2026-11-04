import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InboxNexo Pro",
  description: "Caixas de e-mail temporárias com identificação de códigos de confirmação.",
  robots: { index: false, follow: false },
};

// Aplica o tema antes da pintura (preferência salva ou do sistema).
const themeScript = `(function(){try{var t=localStorage.getItem('inboxnexo-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
