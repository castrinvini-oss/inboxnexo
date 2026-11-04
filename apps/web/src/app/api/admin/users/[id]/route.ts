import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, fail, fromDbError, ok, parseBody, UUID_RE } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  maxMailboxes: z.number().int().min(0).max(1000).nullable(),
  maxMessagesPerHour: z.number().int().min(0).max(10000).nullable(),
  disabled: z.boolean(),
});

export async function PATCH(request: Request, { params }: Ctx) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "usuario_nao_encontrado");
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;

  const { error } = await auth.session.supabase.rpc("admin_update_user", {
    p_user: id,
    p_max_mailboxes: body.data.maxMailboxes,
    p_max_messages_per_hour: body.data.maxMessagesPerHour,
    p_disabled: body.data.disabled,
  });
  if (error) return fromDbError(error);

  // Bloqueia também o login no Supabase Auth (e impede novas renovações).
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(id, {
    ban_duration: body.data.disabled ? "876000h" : "none",
  });
  if (banError) {
    return fail(502, "auth_parcial", "Limites salvos, mas o bloqueio no Supabase Auth falhou. Tente novamente.");
  }
  return ok({ ok: true });
}
