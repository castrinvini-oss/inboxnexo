/**
 * Processamento de uma mensagem recebida pelo Cloudflare Email Routing.
 * Separado de index.ts para ser testável fora do runtime do Workers.
 *
 * Decisões:
 * - Destinatário vem SOMENTE do envelope SMTP (message.to). O cabeçalho "To"
 *   nunca é usado para roteamento ou autorização.
 * - Rejeição permanente (setReject) para: domínio/identificador inválido,
 *   tamanho excedido, MIME impossível de interpretar, caixa inexistente,
 *   desativada ou com cota excedida.
 * - Falha temporária (exceção) para: banco/Edge Function indisponível,
 *   timeout, resposta inesperada. O comportamento do Cloudflare diante de uma
 *   exceção no handler não está documentado na página oficial do handler;
 *   ver docs/DIAGNOSTICO.md. Nunca declaramos sucesso sem confirmação.
 */

import PostalMime from "postal-mime";
import {
  HEADER_EVENT_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  LIMITS,
  extractCode,
  htmlToText,
  parseAuthenticationResults,
  parseRecipient,
  parseServicesConfig,
  sha256Hex,
  sign,
  verifySender,
  type IngestPayload,
} from "@inboxnexo/core";

export interface Env {
  MAIL_DOMAIN: string;
  INGEST_ENDPOINT_URL: string;
  INGEST_HMAC_SECRET: string;
  MAX_RAW_BYTES?: string;
  TRUSTED_AUTHSERV_IDS?: string;
  RECOGNIZED_SENDER_DOMAINS?: string;
  DIAGNOSTIC_AUTH_HEADERS?: string;
  INGEST_TIMEOUT_MS?: string;
}

/** Subconjunto de ForwardableEmailMessage usado aqui. */
export interface IncomingEmail {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
}

export interface Deps {
  fetch: typeof fetch;
  now: () => number;
  uuid: () => string;
  log: (entry: Record<string, unknown>) => void;
}

export type Outcome =
  | "stored"
  | "duplicate"
  | "rejected_recipient"
  | "rejected_size"
  | "rejected_malformed"
  | "rejected_mailbox"
  | "rejected_quota";

export class TemporaryFailure extends Error {
  override name = "TemporaryFailure";
}

const DEFAULT_MAX_RAW = 5 * 1024 * 1024;

async function readWithLimit(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
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
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function processEmail(message: IncomingEmail, env: Env, deps: Deps): Promise<Outcome> {
  const reject = (reason: string, outcome: Outcome): Outcome => {
    message.setReject(reason);
    deps.log({ event: "email_rejected", outcome, rawSize: message.rawSize });
    return outcome;
  };

  const recipient = parseRecipient(message.to, env.MAIL_DOMAIN);
  if (!recipient.ok) return reject("Destinatario invalido", "rejected_recipient");

  const max = Number(env.MAX_RAW_BYTES) > 0 ? Number(env.MAX_RAW_BYTES) : DEFAULT_MAX_RAW;
  if (message.rawSize > max) return reject("Mensagem grande demais", "rejected_size");
  const raw = await readWithLimit(message.raw, max);
  if (raw === null) return reject("Mensagem grande demais", "rejected_size");

  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    // Anexos não são armazenados; "attachmentEncoding" é irrelevante aqui.
    parsed = await PostalMime.parse(raw);
  } catch {
    return reject("Mensagem malformada", "rejected_malformed");
  }

  const subject = (parsed.subject ?? "").replace(/[\r\n]+/g, " ").slice(0, LIMITS.subject);
  const textSource = parsed.text && parsed.text.trim() ? parsed.text : parsed.html ? htmlToText(parsed.html) : "";
  const textBody = textSource.replace(/\r\n/g, "\n").slice(0, LIMITS.textBody);
  const fromAddress = parsed.from?.address ? parsed.from.address.slice(0, LIMITS.fromAddress) : null;
  const fromName = parsed.from?.name ? parsed.from.name.slice(0, LIMITS.fromName) : null;

  const authHeaders = parsed.headers.filter((h) => h.key === "authentication-results").map((h) => h.value);
  if (env.DIAGNOSTIC_AUTH_HEADERS === "true") {
    // Somente os authserv-id, nunca valores completos.
    deps.log({
      event: "diagnostic_auth_headers",
      authservIds: authHeaders.map((h) => parseAuthenticationResults(h)?.authservId ?? "?"),
      arcPresent: parsed.headers.some((h) => h.key === "arc-authentication-results"),
    });
  }
  const sender = verifySender({
    authResultsHeaders: authHeaders,
    fromAddress,
    trustedAuthservIds: list(env.TRUSTED_AUTHSERV_IDS),
    services: parseServicesConfig(env.RECOGNIZED_SENDER_DOMAINS),
  });
  const code = extractCode(subject, textBody);

  const messageId = parsed.messageId ?? "";
  const dateHeader = parsed.headers.find((h) => h.key === "date")?.value ?? "";
  const dedupKey = await sha256Hex(
    [recipient.localPart, messageId, dateHeader, message.from.toLowerCase(), subject, await sha256Hex(textBody)].join("\n"),
  );

  const eventId = deps.uuid();
  const timestamp = Math.floor(deps.now() / 1000);
  const payload: IngestPayload = {
    version: 1,
    eventId,
    timestamp,
    recipient: { localPart: recipient.localPart, tag: recipient.tag ? recipient.tag.slice(0, 64) : null },
    dedupKey,
    fromAddress,
    fromName,
    subject,
    textBody,
    code: { status: code.status, value: code.code, candidates: code.candidates, ruleId: code.ruleId },
    sender: { verification: sender.verification, serviceId: sender.serviceId },
    rawSize: message.rawSize,
  };
  const body = JSON.stringify(payload);
  const signature = await sign(env.INGEST_HMAC_SECRET, String(timestamp), eventId, body);

  let response: Response;
  try {
    response = await deps.fetch(env.INGEST_ENDPOINT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HEADER_TIMESTAMP]: String(timestamp),
        [HEADER_EVENT_ID]: eventId,
        [HEADER_SIGNATURE]: signature,
      },
      body,
      signal: AbortSignal.timeout(Number(env.INGEST_TIMEOUT_MS) > 0 ? Number(env.INGEST_TIMEOUT_MS) : 15_000),
    });
  } catch (err) {
    deps.log({ event: "ingest_network_error", eventId, error: err instanceof Error ? err.name : "erro" });
    throw new TemporaryFailure("Ingestao indisponivel");
  }

  let status: string | undefined;
  try {
    status = ((await response.json()) as { status?: string }).status;
  } catch {
    status = undefined;
  }
  deps.log({ event: "ingest_response", eventId, http: response.status, status });

  if (response.status === 200) {
    switch (status) {
      case "stored":
        return "stored";
      case "duplicate":
        return "duplicate";
      case "unknown_mailbox":
      case "inactive_mailbox":
        return reject("Caixa de correio indisponivel", "rejected_mailbox");
      case "quota_exceeded":
        return reject("Cota da caixa excedida", "rejected_quota");
    }
  }
  throw new TemporaryFailure(`Ingestao falhou (HTTP ${response.status})`);
}
