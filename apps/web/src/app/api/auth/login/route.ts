import { z } from "zod";
import { assertSameOrigin, clientIp, fail, ok, parseBody, rateLimit } from "@/lib/http";
import { safeNextPath } from "@/lib/redirect";
import { createUserClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(256),
  next: z.string().max(300).optional(),
});

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;
  const { email, password, next } = body.data;

  const limited =
    (await rateLimit(`login:ip:${clientIp(request)}`, 900, 30)) ??
    (await rateLimit(`login:email:${email}`, 900, 10));
  if (limited) return limited;

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(401, "credenciais_invalidas", "E-mail ou senha incorretos.");

  const { data: account } = await supabase.rpc("my_account");
  const info = account as { disabled?: boolean; has_admin_role?: boolean } | null;
  if (!info || info.disabled) {
    await supabase.auth.signOut({ scope: "local" });
    return fail(403, "conta_desativada");
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsMfa =
    (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") || (info.has_admin_role === true && aal?.currentLevel !== "aal2");
  const target = safeNextPath(next);
  return ok({ next: needsMfa ? `/mfa?next=${encodeURIComponent(target)}` : target });
}
