import "server-only";
import { createUserClient } from "./supabase/server";
import { fail } from "./http";

export interface SessionInfo {
  userId: string;
  email: string | null;
  aal: string;
  supabase: Awaited<ReturnType<typeof createUserClient>>;
}

/** Valida a sessão no servidor (getClaims verifica a assinatura do JWT). */
export async function getSession(): Promise<SessionInfo | null> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims as { sub: string; email?: string; aal?: string };
  return { userId: claims.sub, email: claims.email ?? null, aal: claims.aal ?? "aal1", supabase };
}

export async function requireSession() {
  const session = await getSession();
  if (!session) return { error: fail(401, "nao_autenticado") } as const;
  return { session } as const;
}

/** Administrador: papel admin (no banco) + sessão aal2 (MFA verificado). */
export async function requireAdmin() {
  const result = await requireSession();
  if ("error" in result) return result;
  const { session } = result;
  if (session.aal !== "aal2") {
    return { error: fail(403, "mfa_obrigatorio", "Verifique o segundo fator (MFA) para acessar a administração.") } as const;
  }
  const { data, error } = await session.supabase.rpc("my_account");
  const account = data as { has_admin_role?: boolean } | null;
  if (error || !account?.has_admin_role) return { error: fail(403, "acesso_negado") } as const;
  return { session } as const;
}
