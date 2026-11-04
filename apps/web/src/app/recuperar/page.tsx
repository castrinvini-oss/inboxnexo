"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, Input, Label } from "@/components/ui";
import { api } from "@/lib/client";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/recover", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao solicitar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Recuperar acesso" subtitle="Enviaremos um link para o seu e-mail externo cadastrado.">
      {sent ? (
        <Alert kind="success">Se o e-mail estiver cadastrado, você receberá um link em instantes. Verifique também o spam.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar link"}</Button>
        </form>
      )}
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-indigo-600 hover:underline dark:text-indigo-400">Voltar ao login</Link>
      </p>
    </AuthShell>
  );
}
