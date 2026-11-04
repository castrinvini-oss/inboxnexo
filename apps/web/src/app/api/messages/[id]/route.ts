import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { assertSameOrigin, fail, fromDbError, ok, parseBody, UUID_RE } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "mensagem_nao_encontrada", "Mensagem não encontrada ou expirada.");
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.session.supabase
    .from("messages")
    .select("id, mailbox_id, from_address, from_name, subject, text_body, code, code_status, code_candidates, sender_verification, sender_service, recipient_tag, received_at, expires_at, read_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail(404, "mensagem_nao_encontrada", "Mensagem não encontrada ou expirada.");
  return ok({ message: data, now: new Date().toISOString() });
}

const patchSchema = z.object({ read: z.boolean() });

export async function PATCH(request: Request, { params }: Ctx) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "mensagem_nao_encontrada", "Mensagem não encontrada ou expirada.");
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, patchSchema);
  if ("error" in body) return body.error;
  const { data, error } = await auth.session.supabase
    .from("messages")
    .update({ read_at: body.data.read ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id, read_at");
  if (error) return fromDbError(error);
  if (!data || data.length === 0) return fail(404, "mensagem_nao_encontrada", "Mensagem não encontrada ou expirada.");
  return ok({ message: data[0] });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "mensagem_nao_encontrada", "Mensagem não encontrada ou expirada.");
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.session.supabase.from("messages").delete().eq("id", id).select("id");
  if (error) return fromDbError(error);
  if (!data || data.length === 0) return fail(404, "mensagem_nao_encontrada", "Mensagem não encontrada ou expirada.");
  return ok({ ok: true });
}
