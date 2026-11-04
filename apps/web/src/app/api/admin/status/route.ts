import { requireAdmin } from "@/lib/auth";
import { fromDbError, ok } from "@/lib/http";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.session.supabase.rpc("admin_ops_status");
  if (error) return fromDbError(error);
  return ok({ status: data, now: new Date().toISOString() });
}
