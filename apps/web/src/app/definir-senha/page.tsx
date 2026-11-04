"use client";

import { useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, Input, Label } from "@/components/ui";
import { api } from "@/lib/client";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) return setError("Use pelo menos 12 caracteres.");
    if (password !== confirm) return setError("As senhas não coincidem.");
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", body: { password } });
      window.location.replace("/caixas");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao definir a senha.");
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Definir senha" subtitle="Escolha uma senha forte com pelo menos 12 caracteres.">
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="password">Nova senha</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="confirm">Confirmar senha</Label>
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar senha"}</Button>
      </form>
    </AuthShell>
  );
}
