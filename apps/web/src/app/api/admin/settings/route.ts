import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, fromDbError, ok, parseBody } from "@/lib/http";

const schema = z.object({
  ingestPaused: z.boolean().nullable(),
  defaultMaxMailboxes: z.number().int().min(0).max(1000).nullable(),
  defaultMaxMessagesPerHour: z.number().int().min(0).max(10000).nullable(),
});

export async function PATCH(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;
  const { error } = await auth.session.supabase.rpc("admin_update_settings", {
    p_ingest_paused: body.data.ingestPaused,
    p_default_max_mailboxes: body.data.defaultMaxMailboxes,
    p_default_max_messages_per_hour: body.data.defaultMaxMessagesPerHour,
  });
  if (error) return fromDbError(error);
  return ok({ ok: true });
}
