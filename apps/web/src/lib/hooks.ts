"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_INTERVAL = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS) || 10_000;

/**
 * Atualização periódica autenticada: pausa com a aba oculta, revalida ao
 * recuperar foco e aplica espera exponencial após falhas (até 60 s).
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = DEFAULT_INTERVAL) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      failures.current = 0;
    } catch (err) {
      failures.current += 1;
      setError(err instanceof Error ? err.message : "Falha ao atualizar.");
    } finally {
      setLoading(false);
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const delay = Math.min(intervalMs * 2 ** failures.current, 60_000);
    timer.current = setTimeout(run, delay);
  }, [intervalMs]);

  useEffect(() => {
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
      else if (timer.current) clearTimeout(timer.current);
    };
    const onFocus = () => void run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [run]);

  return { data, setData, error, loading, refresh: run };
}

/** Relógio compartilhado (1 s) para contagens regressivas. */
export function useNow(tickMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

/** Diferença entre o relógio do servidor e o do navegador (ms). */
export function serverOffset(serverNowIso: string | undefined): number {
  if (!serverNowIso) return 0;
  const server = Date.parse(serverNowIso);
  return Number.isFinite(server) ? server - Date.now() : 0;
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expirada";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
