"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader({ email, isAdmin }: { email: string | null; isAdmin: boolean }) {
  const [leaving, setLeaving] = useState(false);

  // Página restaurada do cache de navegação (botão "voltar"): revalida no
  // servidor em vez de exibir dados antigos, inclusive após o logout.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function logout() {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      // Navegação completa: descarta todo o estado da aplicação em memória.
      window.location.replace("/login");
    }
  }

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/caixas" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">IN</span>
          InboxNexo <span className="text-indigo-600 dark:text-indigo-400">Pro</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/caixas" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            Caixas
          </Link>
          <Link href="/enderecos" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            Endereços
          </Link>
          {isAdmin && (
            <Link href="/admin" className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Administração
            </Link>
          )}
          <ThemeToggle />
          <span className="hidden px-2 text-xs text-slate-500 sm:inline dark:text-slate-400">{email}</span>
          <button
            onClick={logout}
            disabled={leaving}
            className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {leaving ? "Saindo…" : "Sair"}
          </button>
        </nav>
      </div>
    </header>
  );
}
