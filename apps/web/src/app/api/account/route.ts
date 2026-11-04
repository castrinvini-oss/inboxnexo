import { requireSession } from "@/lib/auth";
import { fromDbError, ok } from "@/lib/http";

export async function GET() {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;
  const { data, error } = await auth.session.supabase.rpc("my_account");
  if (error) return fromDbError(error);
  return ok(data);
}
