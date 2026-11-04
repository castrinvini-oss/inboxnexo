import { z } from "zod";
import { validateLocalPart, LOCAL_PART_ERROR_MESSAGES } from "@inboxnexo/core";
import { requireSession } from "@/lib/auth";
import { assertSameOrigin, fail, fromDbError, ok, parseBody, rateLimit } from "@/lib/http";

export async function GET() {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.session.supabase
    .from("mailbox_overview")
    .select("id, local_part, domain, status, created_at, message_count, unread_count, support_until")
    .order("created_at", { ascending: false });
  if (error) return fromDbError(error);
  return ok({ mailboxes: data, now: new Date().toISOString() });
}

const createSchema = z.object({ localPart: z.string().max(64).nullable().optional() });

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, createSchema);
  if ("error" in body) return body.error;

  const localPart = body.data.localPart?.trim() ? body.data.localPart.trim().toLowerCase() : null;
  if (localPart) {
    const invalid = validateLocalPart(localPart);
    if (invalid) return fail(400, "identificador_invalido", LOCAL_PART_ERROR_MESSAGES[invalid]);
  }
  const limited = await rateLimit(`mailbox:create:${auth.session.userId}`, 3600, 30);
  if (limited) return limited;

  const { data, error } = await auth.session.supabase.rpc("create_mailbox", { p_local_part: localPart });
  if (error) return fromDbError(error);
  return ok({ mailbox: data }, 201);
}
