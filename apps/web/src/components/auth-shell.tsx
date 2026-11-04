import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mb-6 flex items-center gap-2 text-xl font-semibold">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 font-bold text-white">IN</span>
        InboxNexo <span className="text-indigo-600 dark:text-indigo-400">Pro</span>
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}
