import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { assertSameOrigin, fail, fromDbError, ok, parseBody, UUID_RE } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ hours: z.number().int().min(1).max(24) });

/** O proprietário autoriza temporariamente o suporte a ler esta caixa. */
export async function POST(request: Request, { params }: Ctx) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "caixa_nao_encontrada");
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, schema);
  if ("error" in body) return body.error;
  const { data, error } = await auth.session.supabase.rpc("grant_support_access", { p_mailbox_id: id, p_hours: body.data.hours });
  if (error) return fromDbError(error);
  return ok({ grant: data });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "caixa_nao_encontrada");
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const { error } = await auth.session.supabase.rpc("revoke_support_access", { p_mailbox_id: id });
  if (error) return fromDbError(error);
  return ok({ ok: true });
}
