import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("<")) {
    throw new Error(`Variável de ambiente ausente ou com placeholder: ${name}`);
  }
  return value;
}

/** Configuração do servidor. Lida sob demanda para não quebrar o build. */
export const serverEnv = {
  get appUrl() {
    return required("APP_URL").replace(/\/$/, "");
  },
  get mailDomain() {
    return process.env.MAIL_DOMAIN ?? "inboxnexo.online";
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabasePublishableKey() {
    return required("SUPABASE_PUBLISHABLE_KEY");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  get isProduction() {
    return process.env.APP_ENV === "production" || process.env.VERCEL_ENV === "production";
  },
};
