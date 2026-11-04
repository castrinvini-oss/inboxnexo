/** Contrato Worker -> Edge Function. Validado de forma explícita no servidor. */

import type { CodeStatus } from "./codes.ts";
import type { SenderVerification } from "./auth-results.ts";

export interface IngestPayload {
  version: 1;
  eventId: string;
  timestamp: number;
  recipient: { localPart: string; tag: string | null };
  dedupKey: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string;
  textBody: string;
  code: { status: CodeStatus; value: string | null; candidates: string[]; ruleId: string | null };
  sender: { verification: SenderVerification; serviceId: string | null };
  rawSize: number;
}

export const LIMITS = {
  subject: 998,
  textBody: 100_000,
  fromAddress: 320,
  fromName: 200,
  bodyBytes: 512 * 1024,
} as const;

const CODE_STATUSES = new Set(["found", "ambiguous", "none"]);
const VERIFICATIONS = new Set(["verificado", "falhou", "nao_verificado"]);

function isStr(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length <= max;
}
function isNullableStr(v: unknown, max: number): v is string | null {
  return v === null || isStr(v, max);
}

export function validatePayload(input: unknown): { ok: true; value: IngestPayload } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, error: "payload" };
  const p = input as Record<string, unknown>;
  if (p.version !== 1) return { ok: false, error: "version" };
  if (!isStr(p.eventId, 64)) return { ok: false, error: "eventId" };
  if (typeof p.timestamp !== "number" || !Number.isInteger(p.timestamp)) return { ok: false, error: "timestamp" };
  const r = p.recipient as Record<string, unknown> | undefined;
  if (!r || !isStr(r.localPart, 32) || !isNullableStr(r.tag, 64)) return { ok: false, error: "recipient" };
  if (!isStr(p.dedupKey, 64) || !/^[0-9a-f]{64}$/.test(p.dedupKey)) return { ok: false, error: "dedupKey" };
  if (!isNullableStr(p.fromAddress, LIMITS.fromAddress)) return { ok: false, error: "fromAddress" };
  if (!isNullableStr(p.fromName, LIMITS.fromName)) return { ok: false, error: "fromName" };
  if (!isStr(p.subject, LIMITS.subject)) return { ok: false, error: "subject" };
  if (!isStr(p.textBody, LIMITS.textBody)) return { ok: false, error: "textBody" };
  const c = p.code as Record<string, unknown> | undefined;
  if (
    !c ||
    !CODE_STATUSES.has(c.status as string) ||
    !(c.value === null || (typeof c.value === "string" && /^\d{4,10}$/.test(c.value))) ||
    !Array.isArray(c.candidates) ||
    c.candidates.length > 5 ||
    !c.candidates.every((x) => typeof x === "string" && /^\d{4,10}$/.test(x)) ||
    !isNullableStr(c.ruleId, 40)
  ) {
    return { ok: false, error: "code" };
  }
  const s = p.sender as Record<string, unknown> | undefined;
  if (!s || !VERIFICATIONS.has(s.verification as string) || !isNullableStr(s.serviceId, 40)) {
    return { ok: false, error: "sender" };
  }
  if (typeof p.rawSize !== "number" || p.rawSize < 0) return { ok: false, error: "rawSize" };
  return { ok: true, value: p as unknown as IngestPayload };
}
