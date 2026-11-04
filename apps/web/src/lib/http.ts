import "server-only";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { serverEnv } from "./env";
import { dbErrorCode, errorMessage } from "./errors";
import { createAdminClient } from "./supabase/admin";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function fail(status: number, code: string, message?: string) {
  return NextResponse.json({ error: code, message: message ?? errorMessage(code) }, { status, headers: NO_STORE });
}

export function fromDbError(error: { message?: string; code?: string } | null) {
  const code = dbErrorCode(error?.message);
  const status =
    code === "erro_interno" ? 500
    : code === "caixa_nao_encontrada" || code === "usuario_nao_encontrado" ? 404
    : code === "acesso_negado" || code === "sem_autorizacao_do_proprietario" || code === "conta_desativada" ? 403
    : code === "nao_autenticado" ? 401
    : 400;
  if (status === 500) console.error(JSON.stringify({ event: "db_error", code: error?.code ?? null }));
  return fail(status, code);
}

/**
 * Proteção CSRF para rotas que alteram estado com cookies: exige Origin
 * igual ao do painel e corpo JSON (formulários de outros sites não
 * conseguem enviar application/json sem preflight CORS).
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const allowed = new Set([serverEnv.appUrl]);
  if (!serverEnv.isProduction) allowed.add(new URL(request.url).origin);
  if (!origin || !allowed.has(origin)) return fail(403, "origem_invalida", "Origem da requisição não permitida.");
  const type = request.headers.get("content-type") ?? "";
  if (request.method !== "DELETE" && !type.startsWith("application/json")) {
    return fail(415, "tipo_invalido", "Envie JSON.");
  }
  return null;
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<{ data: T } | { error: NextResponse }> {
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 10_000) return { error: fail(413, "corpo_grande", "Requisição grande demais.") };
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { error: fail(400, "json_invalido", "JSON inválido.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: fail(400, "dados_invalidos", "Dados inválidos.") };
  return { data: parsed.data };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "desconhecido"
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Limitação de taxa persistente (tabela no Postgres via RPC privilegiada),
 * válida entre instâncias serverless. Falha fechada: sem banco, sem acesso.
 */
export async function rateLimit(key: string, windowSeconds: number, max: number): Promise<NextResponse | null> {
  try {
    const { data, error } = await createAdminClient().rpc("check_rate_limit", {
      p_key: (await sha256(key)).slice(0, 64),
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) throw error;
    if (data === true) return null;
    return fail(429, "muitas_tentativas", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  } catch {
    return fail(503, "indisponivel", "Serviço temporariamente indisponível.");
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
