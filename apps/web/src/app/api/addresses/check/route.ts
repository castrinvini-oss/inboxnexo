import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { assertSameOrigin, fromDbError, ok, parseBody, rateLimit } from "@/lib/http";

const schema = z.object({ localParts: z.array(z.string().max(64)).min(1).max(200) });

/** Verifica disponibilidade (somente leitura; não cria caixas). */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;
  const limited = await rateLimit(`addresses:check:${auth.session.userId}`, 3600, 120);
  if (limited) return limited;

  const { supabase } = auth.session;
  const [{ data, error }, { data: account, error: accountError }] = await Promise.all([
    supabase.rpc("check_local_parts", { p_local_parts: body.data.localParts }),
    supabase.rpc("my_account"),
  ]);
  if (error) return fromDbError(error);
  if (accountError) return fromDbError(accountError);
  const info = account as { mailbox_count: number; max_mailboxes: number };
  return ok({
    results: data as { local_part: string; status: string }[],
    mailboxCount: info.mailbox_count,
    maxMailboxes: info.max_mailboxes,
  });
}
