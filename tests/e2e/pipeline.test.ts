/**
 * Fluxo completo sem rede: Email Worker -> Edge Function (handler) ->
 * PostgreSQL real (PGlite com as migrations) -> leitura com RLS.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { handleIngest, type IngestStatus } from "../../supabase/functions/ingest/handler.ts";
import { processEmail, TemporaryFailure, type Env, type IncomingEmail } from "../../workers/email-ingest/src/process.ts";
import { asService, asUser, createDb, createUser } from "../db/harness.ts";

const SECRET = "k".repeat(64);
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", name));

function email(raw: Uint8Array | string, to: string, from = "bounce@remetente.example") {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  const state = { rejected: null as string | null };
  const msg: IncomingEmail = {
    from,
    to,
    rawSize: bytes.byteLength,
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    setReject: (reason) => {
      state.rejected = reason;
    },
  };
  return { msg, state };
}

let db: PGlite;
let owner: string;
let other: string;
let dbDown = false;
const logs: Record<string, unknown>[] = [];

const env: Env = {
  MAIL_DOMAIN: "inboxnexo.online",
  INGEST_ENDPOINT_URL: "https://ingest.invalid/functions/v1/ingest",
  INGEST_HMAC_SECRET: SECRET,
  TRUSTED_AUTHSERV_IDS: "",
  RECOGNIZED_SENDER_DOMAINS: "instagram:Instagram:mail.instagram.com",
};

/** fetch simulado que entrega a requisição ao handler real da Edge Function. */
const edgeFetch: typeof fetch = async (input, init) => {
  const req = new Request(input as string, init);
  return handleIngest(req, {
    secrets: [SECRET],
    nowSeconds: () => Math.floor(Date.now() / 1000),
    rpc: async (payload) => {
      if (dbDown) throw new Error("connection refused");
      return asService(db, async (tx) => {
        const r = await tx.query<{ r: { status: IngestStatus } }>("select public.ingest_message($1::jsonb) as r", [JSON.stringify(payload)]);
        return r.rows[0]!.r;
      });
    },
  });
};

const deps = { fetch: edgeFetch, now: () => Date.now(), uuid: () => randomUUID(), log: (e: Record<string, unknown>) => logs.push(e) };

async function messagesOf(userId: string) {
  return asUser(db, userId, async (tx) =>
    (await tx.query<{ subject: string; text_body: string; code: string | null; code_status: string; sender_verification: string; recipient_tag: string | null }>(
      "select subject, text_body, code, code_status, sender_verification, recipient_tag from public.messages order by received_at",
    )).rows,
  );
}

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, "dono@externo.test");
  other = await createUser(db, "outro@externo.test");
  await asUser(db, owner, (tx) => tx.query("select public.create_mailbox('caixa-teste')"));
  await asUser(db, other, (tx) => tx.query("select public.create_mailbox('outra-caixa')"));
});

describe("pipeline de recebimento", () => {
  it("entrega na caixa do envelope (não do cabeçalho To), decodifica QP/UTF-8 e extrai o código", async () => {
    const { msg, state } = email(fixture("instagram-qp-multipart.eml"), "Caixa-Teste+ig@inboxnexo.online");
    expect(await processEmail(msg, env, deps)).toBe("stored");
    expect(state.rejected).toBeNull();
    const rows = await messagesOf(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe("012345 é seu código do Instagram");
    expect(rows[0]!.text_body).toContain("Olá! Use o código 012345 para confirmar sua conta. Não compartilhe");
    expect(rows[0]!.code).toBe("012345");
    expect(rows[0]!.recipient_tag).toBe("ig");
    // Sem authserv confiável configurado, o selo não é concedido.
    expect(rows[0]!.sender_verification).toBe("nao_verificado");
    // O cabeçalho visual "To: outra-caixa@" não desviou a mensagem.
    expect(await messagesOf(other)).toHaveLength(0);
  });

  it("reentrega da mesma mensagem não duplica", async () => {
    const { msg } = email(fixture("instagram-qp-multipart.eml"), "caixa-teste+ig@inboxnexo.online");
    expect(await processEmail(msg, env, deps)).toBe("duplicate");
    expect(await messagesOf(owner)).toHaveLength(1);
  });

  it("decodifica Base64 UTF-8 e preserva zero à esquerda", async () => {
    const { msg } = email(fixture("base64-utf8.eml"), "caixa-teste@inboxnexo.online");
    expect(await processEmail(msg, env, deps)).toBe("stored");
    const row = (await messagesOf(owner)).find((r) => r.subject === "Verificação de acesso")!;
    expect(row.text_body).toContain("Olá, João!");
    expect(row.code).toBe("004219");
  });

  it("HTML vira texto sem conteúdo ativo", async () => {
    const { msg } = email(fixture("html-only-active.eml"), "caixa-teste@inboxnexo.online");
    expect(await processEmail(msg, env, deps)).toBe("stored");
    const row = (await messagesOf(owner)).find((r) => r.subject === "Security code")!;
    expect(row.text_body).toContain("Your security code is 778899");
    expect(row.text_body).not.toMatch(/<|script|alert|pixel|javascript:|evil\.example/);
    expect(row.code).toBe("778899");
    expect(row.sender_verification).toBe("nao_verificado");
  });

  it("ISO-8859-1 sem código: números de data, telefone, CEP e valores não viram código", async () => {
    const { msg } = email(fixture("newsletter-sem-codigo.eml"), "caixa-teste@inboxnexo.online");
    expect(await processEmail(msg, env, deps)).toBe("stored");
    const row = (await messagesOf(owner)).find((r) => r.subject === "Ofertas da semana")!;
    expect(row.text_body).toContain("Promoções válidas");
    expect(row.code_status).toBe("none");
  });

  it("remetente falsificado não recebe selo mesmo com authserv confiável configurado", async () => {
    // Simula o cabeçalho do MTA confiável no topo; o forjado fica abaixo.
    const spoof = "Authentication-Results: mx.cloudflare.net; spf=fail smtp.mailfrom=spoof.example; dmarc=fail header.from=mail.instagram.com\r\n" +
      fixture("spoofed-instagram.eml").toString("utf8");
    const { msg } = email(spoof, "caixa-teste@inboxnexo.online", "x@spoof.example");
    expect(await processEmail(msg, { ...env, TRUSTED_AUTHSERV_IDS: "mx.cloudflare.net" }, deps)).toBe("stored");
    const row = (await messagesOf(owner)).find((r) => r.subject === "123456 is your Instagram code")!;
    expect(row.code).toBe("123456");
    expect(row.sender_verification).toBe("falhou");
  });

  it("destinatário desconhecido é rejeitado e não cria caixa", async () => {
    const { msg, state } = email(fixture("base64-utf8.eml"), "ninguem@inboxnexo.online");
    expect(await processEmail(msg, env, deps)).toBe("rejected_mailbox");
    expect(state.rejected).toMatch(/indisponivel/);
    const n = await db.query<{ n: number }>("select count(*)::int as n from public.mailboxes where local_part = 'ninguem'");
    expect(n.rows[0]!.n).toBe(0);
  });

  it("domínio diferente é rejeitado sem chamar a ingestão", async () => {
    const { msg, state } = email(fixture("base64-utf8.eml"), "caixa-teste@outro-dominio.example");
    expect(await processEmail(msg, env, deps)).toBe("rejected_recipient");
    expect(state.rejected).not.toBeNull();
  });

  it("mensagem acima do limite é rejeitada", async () => {
    const big = "Subject: grande\r\n\r\n" + "a".repeat(2048);
    const { msg } = email(big, "caixa-teste@inboxnexo.online");
    expect(await processEmail(msg, { ...env, MAX_RAW_BYTES: "1024" }, deps)).toBe("rejected_size");
  });

  it("falha do banco não é apresentada como sucesso", async () => {
    dbDown = true;
    const { msg, state } = email("Subject: novo\r\nMessage-ID: <x@y>\r\n\r\nSeu código é 135790", "caixa-teste@inboxnexo.online");
    await expect(processEmail(msg, env, deps)).rejects.toBeInstanceOf(TemporaryFailure);
    expect(state.rejected).toBeNull();
    dbDown = false;
  });

  it("falha de rede é falha temporária", async () => {
    const { msg } = email("Subject: rede\r\n\r\nx", "caixa-teste@inboxnexo.online");
    const failing = { ...deps, fetch: (async () => { throw new TypeError("network"); }) as typeof fetch };
    await expect(processEmail(msg, env, failing)).rejects.toBeInstanceOf(TemporaryFailure);
  });

  it("segredo errado no Worker resulta em falha temporária (401), nunca sucesso", async () => {
    const { msg } = email("Subject: segredo\r\n\r\nx", "caixa-teste@inboxnexo.online");
    await expect(processEmail(msg, { ...env, INGEST_HMAC_SECRET: "z".repeat(64) }, deps)).rejects.toThrow(/401/);
  });

  it("logs não contêm corpo, código, assunto ou segredo", () => {
    const text = JSON.stringify(logs);
    expect(text).not.toMatch(/012345|004219|Instagram code|Olá|kkkkkkkk/);
  });
});
