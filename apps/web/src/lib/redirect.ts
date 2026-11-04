/** Aceita apenas caminhos internos; bloqueia "//host", "/\host" e URLs absolutas. */
export function safeNextPath(value: string | null | undefined, fallback = "/caixas"): string {
  if (!value || typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value) || value.includes("://")) return fallback;
  return value;
}
