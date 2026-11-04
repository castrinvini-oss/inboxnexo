import { requireSession } from "@/lib/auth";
import { fail, fromDbError, ok, UUID_RE } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/** Lista mensagens (sem corpo). A RLS garante dono + prazo de validade. */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "caixa_nao_encontrada");
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const { supabase } = auth.session;

  const { data: mailbox, error: mbError } = await supabase
    .from("mailboxes")
    .select("id, local_part, domain, status")
    .eq("id", id)
    .maybeSingle();
  if (mbError) return fromDbError(mbError);
  if (!mailbox) return fail(404, "caixa_nao_encontrada");

  const { data, error } = await supabase
    .from("messages")
    .select("id, from_address, from_name, subject, code, code_status, sender_verification, sender_service, received_at, expires_at, read_at")
    .eq("mailbox_id", id)
    .order("received_at", { ascending: false })
    .limit(100);
  if (error) return fromDbError(error);
  return ok({ mailbox, messages: data, now: new Date().toISOString() });
}
