"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** Somente a preferência de tema fica no navegador; nunca mensagens. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("inboxnexo-theme", next);
    } catch {
      // armazenamento indisponível: o tema vale só para esta página
    }
    setTheme(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
      className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {theme === "dark" ? "☀ Claro" : "☾ Escuro"}
    </button>
  );
}
