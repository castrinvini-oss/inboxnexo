"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Button, Input, Label, Spinner } from "@/components/ui";
import { api } from "@/lib/client";

interface MfaState {
  currentLevel: string;
  verifiedFactors: { id: string; name: string }[];
}

export function MfaFlow({ next }: { next: string }) {
  const [state, setState] = useState<MfaState | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<MfaState>("/api/auth/mfa").then(setState).catch((e: Error) => setError(e.message));
  }, []);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    try {
      setEnroll(await api("/api/auth/mfa", { method: "POST", body: { action: "enroll" } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const factorId = enroll?.factorId ?? state?.verifiedFactors[0]?.id;
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/mfa", { method: "POST", body: { action: "verify", factorId, code } });
      window.location.replace(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!state && !error) return <Spinner />;
  if (state?.currentLevel === "aal2") {
    return (
      <div className="space-y-4">
        <Alert kind="success">Segundo fator já verificado nesta sessão.</Alert>
        <Link href={next} className="text-indigo-600 hover:underline dark:text-indigo-400">Continuar</Link>
      </div>
    );
  }

  const hasFactor = (state?.verifiedFactors.length ?? 0) > 0;
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {!hasFactor && !enroll && (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Cadastre um aplicativo autenticador (TOTP), como Google Authenticator, 1Password ou Authy.
          </p>
          <Button onClick={startEnroll} disabled={busy}>Cadastrar autenticador</Button>
        </>
      )}
      {enroll && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">Escaneie o QR code no aplicativo autenticador:</p>
          {/* QR gerado pelo Supabase Auth como data URL SVG (sem recursos remotos). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enroll.qrCode} alt="QR code do autenticador" className="mx-auto h-44 w-44 rounded bg-white p-2" />
          <p className="break-all text-xs text-slate-500">Chave manual: <code>{enroll.secret}</code></p>
        </div>
      )}
      {(hasFactor || enroll) && (
        <form onSubmit={verify} className="space-y-3">
          <div>
            <Label htmlFor="code">Código de 6 dígitos</Label>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </div>
          <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Verificando…" : "Verificar"}</Button>
        </form>
      )}
      <p className="text-xs text-slate-500">
        <Link href="/caixas" className="hover:underline">Ir para minhas caixas sem acessar a administração</Link>
      </p>
    </div>
  );
}
