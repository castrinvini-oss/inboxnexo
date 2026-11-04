"use client";

import { CopyButton } from "./ui";
import { formatRemaining, formatTime } from "@/lib/hooks";

export function Countdown({ expiresAt, now }: { expiresAt: string; now: number }) {
  const remaining = Date.parse(expiresAt) - now;
  const urgent = remaining < 5 * 60_000;
  return (
    <span className={`font-mono text-xs ${urgent ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400"}`} title="Tempo até a exclusão">
      ⏱ {formatRemaining(remaining)}
    </span>
  );
}

export function VerificationBadge({ verification, service }: { verification: string; service: string | null }) {
  if (verification === "verificado") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
        ✓ Remetente autenticado{service ? ` (${service === "instagram" ? "Instagram" : service})` : ""}
      </span>
    );
  }
  if (verification === "falhou") {
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-900 dark:text-rose-200">
        ✗ Autenticação do remetente falhou
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
      Remetente não verificado
    </span>
  );
}

export function CodePanel({
  status, code, candidates, receivedAt,
}: {
  status: string;
  code: string | null;
  candidates: string[];
  receivedAt: string;
}) {
  if (status === "found" && code) {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950">
        <div>
          <p className="text-xs uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Código identificado</p>
          <p className="font-mono text-3xl font-bold tracking-[0.3em] text-indigo-900 dark:text-indigo-100">{code}</p>
          <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80">Recebido às {formatTime(receivedAt)}</p>
        </div>
        <CopyButton value={code} label="Copiar código" />
      </div>
    );
  }
  if (status === "ambiguous") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Mais de um possível código encontrado ({candidates.join(", ")}). Confira o texto da mensagem.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      Nenhum código identificado
    </div>
  );
}
