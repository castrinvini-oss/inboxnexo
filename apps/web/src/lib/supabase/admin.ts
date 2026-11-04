import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "../env";

/**
 * Cliente privilegiado (ignora RLS). Uso restrito a: limitação de taxa,
 * auditoria de ações já autorizadas e operações do Auth Admin (convite,
 * bloqueio). Nunca usar para ler dados de usuários em nome deles.
 */
export function createAdminClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
