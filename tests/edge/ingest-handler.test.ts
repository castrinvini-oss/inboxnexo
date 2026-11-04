import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleIngest, type IngestDeps } from "../../supabase/functions/ingest/handler.ts";
import { sign } from "../../packages/core/src/hmac.ts";

const SECRET = "a".repeat(64);
const NOW = 1_800_000_000;

function payload(eventId: string, timestamp = NOW) {
  return {
    version: 1, eventId, timestamp,
    recipient: { localPart: "cliente01", tag: null },
    dedupKey: "f".repeat(64),
    fromAddress: null, fromName: null, subject: "s", textBody: "t",
    code: { status: "none", value: null, candidates: [], ruleId: null },
    sender: { verification: "nao_verificado", serviceId: null },
    rawSize: 10,
  };
}

async function signedRequest(opts: { secret?: string; ts?: number; eventId?: string; mutate?: (b: string) => string; body?: object } = {}) {
  const eventId = opts.eventId ?? randomUUID();
  const ts = opts.ts ?? NOW;
  const body = JSON.stringify(opts.body ?? payload(eventId, ts));
  const signature = await sign(opts.secret ?? SECRET, String(ts), eventId, body);
  return new Request("https://x/ingest", {
    method: "POST",
    headers: { "x-inboxnexo-timestamp": String(ts), "x-inboxnexo-event-id": eventId, "x-inboxnexo-signature": signature },
    body: opts.mutate ? opts.mutate(body) : body,
  });
}

function deps(rpc: IngestDeps["rpc"] = async () => ({ status: "stored" })): IngestDeps {
  return { secrets: [SECRET], nowSeconds: () => NOW, rpc };
}

describe("Edge Function de ingestão", () => {
  it("aceita requisição assinada", async () => {
    const res = await handleIngest(await signedRequest(), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "stored" });
  });

  it("rejeita assinatura ausente sem consultar o banco", async () => {
    const rpc = vi.fn();
    const req = new Request("https://x/ingest", { method: "POST", body: "{}" });
    expect((await handleIngest(req, deps(rpc))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejeita assinatura inválida e corpo adulterado", async () => {
    const rpc = vi.fn();
    expect((await handleIngest(await signedRequest({ secret: "b".repeat(64) }), deps(rpc))).status).toBe(401);
    expect((await handleIngest(await signedRequest({ mutate: (b) => b.replace('"s"', '"S"') }), deps(rpc))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejeita assinatura expirada", async () => {
    expect((await handleIngest(await signedRequest({ ts: NOW - 301 }), deps())).status).toBe(401);
    expect((await handleIngest(await signedRequest({ ts: NOW + 301 }), deps())).status).toBe(401);
  });

  it("replay detectado pelo banco retorna 409", async () => {
    const res = await handleIngest(await signedRequest(), deps(async () => ({ status: "replay" })));
    expect(res.status).toBe(409);
  });

  it("rejeita eventId do corpo diferente do cabeçalho", async () => {
    const eventId = randomUUID();
    const res = await handleIngest(await signedRequest({ eventId, body: payload(randomUUID()) }), deps());
    expect(res.status).toBe(400);
  });

  it("falha do banco retorna 503, nunca sucesso", async () => {
    const res = await handleIngest(await signedRequest(), deps(async () => { throw new Error("db"); }));
    expect(res.status).toBe(503);
  });

  it("limita o tamanho do corpo", async () => {
    const res = await handleIngest(await signedRequest(), { ...deps(), maxBodyBytes: 10 });
    expect(res.status).toBe(413);
  });

  it("aceita somente POST", async () => {
    expect((await handleIngest(new Request("https://x/ingest"), deps())).status).toBe(405);
  });
});
