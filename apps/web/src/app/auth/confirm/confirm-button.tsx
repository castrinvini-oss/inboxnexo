"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { api } from "@/lib/client";

export function ConfirmButton({ tokenHash, type }: { tokenHash: string; type: "invite" | "recovery" | "email" }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ next: string }>("/api/auth/confirm", { method: "POST", body: { token_hash: tokenHash, type } });
      window.location.replace(res.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na confirmação.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Button onClick={confirm} disabled={busy}>{busy ? "Confirmando…" : "Continuar"}</Button>
    </div>
  );
}
