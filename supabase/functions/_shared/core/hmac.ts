/**
 * Assinatura HMAC-SHA-256 entre o Worker e a Edge Function de ingestão.
 *
 * Cabeçalhos:
 *   X-InboxNexo-Timestamp: segundos Unix
 *   X-InboxNexo-Event-Id:  UUID do evento (único por requisição)
 *   X-InboxNexo-Signature: v1=<hex>
 * Conteúdo assinado: "v1:" + timestamp + ":" + eventId + ":" + corpo exato.
 * Funciona em Workers, Deno e Node (Web Crypto).
 */

export const SIGNATURE_VERSION = "v1";
export const HEADER_TIMESTAMP = "x-inboxnexo-timestamp";
export const HEADER_EVENT_ID = "x-inboxnexo-event-id";
export const HEADER_SIGNATURE = "x-inboxnexo-signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export function signedPayload(timestamp: string, eventId: string, body: string): string {
  return `${SIGNATURE_VERSION}:${timestamp}:${eventId}:${body}`;
}

export async function sign(secret: string, timestamp: string, eventId: string, body: string): Promise<string> {
  const key = await importKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload(timestamp, eventId, body)));
  return `${SIGNATURE_VERSION}=${toHex(mac)}`;
}

/** Comparação em tempo constante (independe da posição da primeira diferença). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VerifyFailure =
  | "cabecalhos_ausentes"
  | "timestamp_invalido"
  | "fora_da_janela"
  | "evento_invalido"
  | "assinatura_invalida";

export interface VerifyOptions {
  secrets: string[];
  nowSeconds: number;
  toleranceSeconds?: number;
}

export async function verifySignature(
  headers: { timestamp: string | null; eventId: string | null; signature: string | null },
  body: string,
  options: VerifyOptions,
): Promise<{ ok: true } | { ok: false; reason: VerifyFailure }> {
  const { timestamp, eventId, signature } = headers;
  if (!timestamp || !eventId || !signature) return { ok: false, reason: "cabecalhos_ausentes" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "timestamp_invalido" };
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(options.nowSeconds - Number(timestamp)) > tolerance) return { ok: false, reason: "fora_da_janela" };
  if (!UUID_RE.test(eventId)) return { ok: false, reason: "evento_invalido" };
  let valid = false;
  for (const secret of options.secrets.filter((s) => s.length >= 32)) {
    const expected = await sign(secret, timestamp, eventId, body);
    if (timingSafeEqual(expected, signature)) valid = true;
  }
  return valid ? { ok: true } : { ok: false, reason: "assinatura_invalida" };
}
