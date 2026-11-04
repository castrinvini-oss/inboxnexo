import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { assertSameOrigin, fail, ok, parseBody, rateLimit } from "@/lib/http";

export async function GET() {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const { supabase } = auth.session;
  const [{ data: factors }, { data: aal }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  return ok({
    currentLevel: aal?.currentLevel ?? "aal1",
    verifiedFactors: (factors?.totp ?? []).map((f) => ({ id: f.id, name: f.friendly_name ?? "Autenticador" })),
  });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }),
]);

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;
  const { supabase, userId } = auth.session;

  if (body.data.action === "enroll") {
    // Remove fatores não verificados de tentativas anteriores.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `InboxNexo ${Date.now()}` });
    if (error || !data) return fail(400, "mfa_falhou", "Não foi possível iniciar o cadastro do autenticador.");
    return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  const limited = await rateLimit(`mfa:user:${userId}`, 900, 10);
  if (limited) return limited;
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: body.data.factorId, code: body.data.code });
  if (error) return fail(400, "codigo_invalido", "Código inválido. Confira o horário do dispositivo e tente novamente.");
  return ok({ ok: true });
}
