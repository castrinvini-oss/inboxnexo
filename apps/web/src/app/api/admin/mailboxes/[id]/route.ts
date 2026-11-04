import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin, fail, fromDbError, ok, parseBody, UUID_RE } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ status: z.enum(["active", "disabled"]) });

export async function PATCH(request: Request, { params }: Ctx) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "caixa_nao_encontrada");
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;
  const { data, error } = await auth.session.supabase.rpc("set_mailbox_status", { p_id: id, p_status: body.data.status });
  if (error) return fromDbError(error);
  return ok({ mailbox: data });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "caixa_nao_encontrada");
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { error } = await auth.session.supabase.rpc("delete_mailbox", { p_id: id });
  if (error) return fromDbError(error);
  return ok({ ok: true });
}
