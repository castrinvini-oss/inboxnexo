import { requireAdmin } from "@/lib/auth";
import { fail, fromDbError, ok, UUID_RE } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Leitura de suporte: exige MFA, autorização vigente do proprietário e é
 * registrada na auditoria pelo próprio banco (admin_read_mailbox_messages).
 */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail(404, "caixa_nao_encontrada");
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.session.supabase.rpc("admin_read_mailbox_messages", { p_mailbox_id: id });
  if (error) return fromDbError(error);
  return ok({ messages: data, now: new Date().toISOString() });
}
