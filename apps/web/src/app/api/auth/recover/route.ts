import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { assertSameOrigin, clientIp, ok, parseBody, rateLimit } from "@/lib/http";
import { createUserClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

/** Sempre responde igual, exista ou não a conta (evita enumeração). */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;

  const limited =
    (await rateLimit(`recover:ip:${clientIp(request)}`, 3600, 10)) ??
    (await rateLimit(`recover:email:${body.data.email}`, 3600, 3));
  if (limited) return limited;

  const supabase = await createUserClient();
  await supabase.auth.resetPasswordForEmail(body.data.email, { redirectTo: `${serverEnv.appUrl}/auth/confirm` });
  return ok({ ok: true });
}
