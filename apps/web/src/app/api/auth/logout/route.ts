import { assertSameOrigin, ok } from "@/lib/http";
import { createUserClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const supabase = await createUserClient();
  await supabase.auth.signOut({ scope: "local" });
  return ok({ ok: true });
}
