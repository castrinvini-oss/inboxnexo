"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Input, Label } from "@/components/ui";
import { api } from "@/lib/client";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ next: string }>("/api/auth/login", { method: "POST", body: { email, password, next } });
      window.location.replace(res.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao entrar.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <div>
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="password">Senha</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
      <p className="text-sm">
        <Link href="/recuperar" className="text-indigo-600 hover:underline dark:text-indigo-400">Esqueci minha senha</Link>
      </p>
    </form>
  );
}
