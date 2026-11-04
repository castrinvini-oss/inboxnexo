import { AuthShell } from "@/components/auth-shell";
import { safeNextPath } from "@/lib/redirect";
import { MfaFlow } from "./mfa-flow";

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell title="Verificação em duas etapas" subtitle="Obrigatória para administradores.">
      <MfaFlow next={safeNextPath(next)} />
    </AuthShell>
  );
}
