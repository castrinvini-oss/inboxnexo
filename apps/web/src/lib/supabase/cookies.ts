import type { CookieOptions } from "@supabase/ssr";

/**
 * Cookies de sessão: HttpOnly (inacessíveis ao JavaScript), Secure em
 * produção e SameSite=Lax. O navegador nunca fala diretamente com o
 * Supabase; todas as chamadas passam pelas rotas do Next.js.
 */
export function hardenCookie(options: CookieOptions | undefined): CookieOptions {
  const secure = process.env.NODE_ENV === "production";
  return { ...options, httpOnly: true, secure, sameSite: "lax", path: "/" };
}
