import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { assertSameOrigin, fail, ok, parseBody } from "@/lib/http";

const schema = z.object({ password: z.string().min(12).max(128) });

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;

  const { error } = await auth.session.supabase.auth.updateUser({ password: body.data.password });
  if (error) {
    return fail(400, "senha_rejeitada", "Não foi possível definir a senha. Use uma senha forte e diferente da anterior.");
  }
  return ok({ ok: true });
}
