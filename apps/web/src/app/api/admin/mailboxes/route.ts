import { requireAdmin } from "@/lib/auth";
import { fromDbError, ok } from "@/lib/http";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const search = new URL(request.url).searchParams.get("q")?.slice(0, 100) || null;
  const { data, error } = await auth.session.supabase.rpc("admin_list_mailboxes", { p_search: search });
  if (error) return fromDbError(error);
  return ok({ mailboxes: data });
}
