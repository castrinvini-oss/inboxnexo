import { z } from "zod";
import { assertSameOrigin, clientIp, fail, ok, parseBody, rateLimit } from "@/lib/http";
import { createUserClient } from "@/lib/supabase/server";

// A confirmação é feita por POST (botão na página /auth/confirm), para que
// verificadores automáticos de links em e-mails não consumam o token.
const schema = z.object({
  token_hash: z.string().min(10).max(500),
  type: z.enum(["invite", "recovery", "email"]),
});

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;
  const limited = await rateLimit(`confirm:ip:${clientIp(request)}`, 900, 20);
  if (limited) return limited;

  const supabase = await createUserClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: body.data.token_hash, type: body.data.type });
  if (error) return fail(400, "link_invalido", "Link inválido ou expirado. Solicite um novo.");
  return ok({ next: body.data.type === "email" ? "/caixas" : "/definir-senha" });
}
