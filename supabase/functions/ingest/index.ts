// Edge Function "ingest" (Deno). Recebe somente requisições assinadas pelo
// Email Worker. verify_jwt = false em supabase/config.toml: a autenticação é
// o HMAC, verificado em handler.ts antes de qualquer processamento.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { handleIngest, type IngestStatus } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
// Credencial privilegiada SOMENTE no servidor. Preferimos um segredo dedicado
// (chave secreta sb_secret_...); SUPABASE_SERVICE_ROLE_KEY é o fallback
// injetado automaticamente pelo Supabase.
const serverKey = Deno.env.get("INBOXNEXO_SERVER_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const secrets = [Deno.env.get("INGEST_HMAC_SECRET"), Deno.env.get("INGEST_HMAC_SECRET_PREVIOUS")].filter(
  (s): s is string => typeof s === "string" && s.length > 0,
);

if (!supabaseUrl || !serverKey || secrets.length === 0) {
  throw new Error("Configuração ausente: SUPABASE_URL, INBOXNEXO_SERVER_SECRET e INGEST_HMAC_SECRET");
}

const db = createClient(supabaseUrl, serverKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) =>
  handleIngest(req, {
    secrets,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    log: (entry) => console.log(JSON.stringify(entry)),
    rpc: async (payload) => {
      const { data, error } = await db.rpc("ingest_message", { p: payload });
      if (error) throw new Error(`rpc:${error.code ?? "desconhecido"}`);
      const result = data as { status: IngestStatus; messageId?: string };
      return result;
    },
  }),
);
