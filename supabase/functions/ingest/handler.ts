/**
 * Lógica da Edge Function de ingestão, independente do runtime (Deno/Node),
 * para permitir testes automatizados. Ordem obrigatória:
 *   1. limite de tamanho  2. assinatura HMAC (antes de interpretar o corpo)
 *   3. validação do payload  4. RPC transacional (replay + caixa + dedup)
 */

import {
  HEADER_EVENT_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  verifySignature,
} from "../_shared/core/hmac.ts";
import { LIMITS, validatePayload, type IngestPayload } from "../_shared/core/ingest-payload.ts";

export type IngestStatus =
  | "stored"
  | "duplicate"
  | "replay"
  | "unknown_mailbox"
  | "inactive_mailbox"
  | "quota_exceeded"
  | "paused"
  | "invalid";

export interface IngestDeps {
  secrets: string[];
  nowSeconds: () => number;
  rpc: (payload: IngestPayload) => Promise<{ status: IngestStatus; messageId?: string }>;
  log?: (entry: Record<string, unknown>) => void;
  maxBodyBytes?: number;
}

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

async function readLimited(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

const HTTP_BY_STATUS: Record<IngestStatus, number> = {
  stored: 200,
  duplicate: 200,
  unknown_mailbox: 200,
  inactive_mailbox: 200,
  quota_exceeded: 200,
  replay: 409,
  paused: 503,
  invalid: 400,
};

export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  const started = Date.now();
  const log = deps.log ?? (() => {});
  const max = deps.maxBodyBytes ?? LIMITS.bodyBytes;

  if (req.method !== "POST") return json(405, { error: "metodo_nao_permitido" });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) return json(413, { error: "payload_grande_demais" });

  let body: string | null;
  try {
    body = await readLimited(req, max);
  } catch {
    return json(400, { error: "corpo_invalido" });
  }
  if (body === null) return json(413, { error: "payload_grande_demais" });

  const eventId = req.headers.get(HEADER_EVENT_ID);
  const timestamp = req.headers.get(HEADER_TIMESTAMP);
  const verified = await verifySignature(
    { timestamp, eventId, signature: req.headers.get(HEADER_SIGNATURE) },
    body,
    { secrets: deps.secrets, nowSeconds: deps.nowSeconds() },
  );
  if (!verified.ok) {
    log({ event: "ingest_rejected", reason: verified.reason });
    return json(401, { error: "nao_autorizado" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(400, { error: "json_invalido" });
  }
  const valid = validatePayload(parsed);
  if (!valid.ok) return json(400, { error: "payload_invalido", field: valid.error });
  if (valid.value.eventId !== eventId || String(valid.value.timestamp) !== timestamp) {
    return json(400, { error: "cabecalhos_divergentes" });
  }

  try {
    const result = await deps.rpc(valid.value);
    const http = HTTP_BY_STATUS[result.status] ?? 500;
    log({ event: "ingest", eventId, status: result.status, ms: Date.now() - started });
    return json(http, { status: result.status });
  } catch (err) {
    // Falha no banco: NÃO declarar sucesso. O Worker trata como falha temporária.
    log({ event: "ingest_db_error", eventId, error: err instanceof Error ? err.name : "erro", ms: Date.now() - started });
    return json(503, { error: "banco_indisponivel" });
  }
}
