import { AuthShell } from "@/components/auth-shell";
import { safeNextPath } from "@/lib/redirect";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell title="Entrar" subtitle="Acesso por convite. Use o e-mail externo cadastrado.">
      <LoginForm next={safeNextPath(next)} />
    </AuthShell>
  );
}
