import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui";
import { ConfirmButton } from "./confirm-button";

const TYPES = new Set(["invite", "recovery", "email"]);

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash, type } = await searchParams;
  const valid = typeof token_hash === "string" && token_hash.length >= 10 && typeof type === "string" && TYPES.has(type);
  return (
    <AuthShell
      title={type === "invite" ? "Aceitar convite" : "Confirmar acesso"}
      subtitle="Por segurança, confirme clicando no botão abaixo."
    >
      {valid ? (
        <ConfirmButton tokenHash={token_hash} type={type as "invite" | "recovery" | "email"} />
      ) : (
        <Alert>Link inválido ou incompleto. Solicite um novo convite ou link de recuperação.</Alert>
      )}
    </AuthShell>
  );
}
