import { describe, expect, it } from "vitest";
import {
  extractCode,
  htmlToText,
  parseRecipient,
  randomLocalPart,
  sign,
  validateLocalPart,
  validatePayload,
  verifySender,
  verifySignature,
  parseServicesConfig,
} from "./index.ts";

describe("normalização", () => {
  it("aceita identificadores válidos e rejeita inválidos", () => {
    expect(validateLocalPart("cliente01")).toBeNull();
    expect(validateLocalPart("a.b-c_d")).toBeNull();
    expect(validateLocalPart("ab")).toBe("curto");
    expect(validateLocalPart("a+b")).toBe("caracteres_invalidos");
    expect(validateLocalPart(".abc")).toBe("caracteres_invalidos");
    expect(validateLocalPart("a..bc")).toBe("pontos_consecutivos");
    expect(validateLocalPart("joão")).toBe("caracteres_invalidos");
    expect(validateLocalPart("x".repeat(33))).toBe("longo");
  });

  it("usa o mesmo critério no recebimento, com subendereço +", () => {
    expect(parseRecipient("Cliente01+Promo@InboxNexo.Online", "inboxnexo.online")).toEqual({
      ok: true, localPart: "cliente01", tag: "promo", address: "cliente01@inboxnexo.online",
    });
    expect(parseRecipient("a.b.c@inboxnexo.online", "inboxnexo.online")).toMatchObject({ localPart: "a.b.c" });
    expect(parseRecipient("abc@sub.inboxnexo.online", "inboxnexo.online")).toEqual({ ok: false, reason: "dominio_incorreto" });
    expect(parseRecipient("abc@inboxnexo.online.evil.com", "inboxnexo.online")).toEqual({ ok: false, reason: "dominio_incorreto" });
    expect(parseRecipient("a@b@inboxnexo.online", "inboxnexo.online")).toEqual({ ok: false, reason: "formato_invalido" });
    expect(parseRecipient("+x@inboxnexo.online", "inboxnexo.online")).toEqual({ ok: false, reason: "identificador_invalido" });
  });

  it("gera identificadores aleatórios válidos", () => {
    for (let i = 0; i < 50; i++) expect(validateLocalPart(randomLocalPart())).toBeNull();
  });
});

describe("extração de códigos", () => {
  it("reconhece código do Instagram em inglês e português", () => {
    expect(extractCode("123456 is your Instagram code", "")).toMatchObject({ status: "found", code: "123456", ruleId: "instagram" });
    expect(extractCode("098765 é seu código do Instagram", "")).toMatchObject({ status: "found", code: "098765" });
  });

  it("preserva zeros à esquerda", () => {
    const r = extractCode("Verifique sua conta", "Use o código 000417 para confirmar sua conta.");
    expect(r).toMatchObject({ status: "found", code: "000417" });
    expect(typeof r.code).toBe("string");
  });

  it("não classifica números sem contexto", () => {
    expect(extractCode("Newsletter", "Nosso endereço: Rua X, 123456. Visite-nos.").status).toBe("none");
    expect(extractCode("Pedido enviado", "Pedido 482913 enviado").status).toBe("none");
  });

  it("evita datas, telefones, valores e protocolos", () => {
    const body = [
      "Seu código de segurança está abaixo.",
      "Data: 12/03/2024 às 10:30",
      "Telefone: +55 11 987654 321",
      "Total: R$ 123456",
      "Protocolo: 654321",
    ].join("\n");
    expect(extractCode("Segurança", body).status).toBe("none");
  });

  it("trata múltiplos candidatos como ambiguidade", () => {
    const r = extractCode("Código de verificação", "Seu código é 111111. Código alternativo: 222222.");
    expect(r.status).toBe("ambiguous");
    expect(r.code).toBeNull();
    expect(r.candidates).toEqual(["111111", "222222"]);
  });

  it("nome do Instagram no remetente não gera código sem evidência", () => {
    expect(extractCode("Instagram", "Veja o que você perdeu hoje.").status).toBe("none");
  });
});

describe("verificação do remetente", () => {
  const services = parseServicesConfig("instagram:Instagram:mail.instagram.com");
  const trusted = ["mx.cloudflare.net"];
  const good = "mx.cloudflare.net; spf=pass smtp.mailfrom=mail.instagram.com; dkim=pass header.d=mail.instagram.com; dmarc=pass header.from=mail.instagram.com";

  it("verifica DMARC alinhado de domínio reconhecido vindo de authserv confiável", () => {
    expect(verifySender({ authResultsHeaders: [good], fromAddress: "security@mail.instagram.com", trustedAuthservIds: trusted, services }))
      .toMatchObject({ verification: "verificado", serviceId: "instagram" });
  });

  it("sem lista confiável configurada, nada é verificado", () => {
    expect(verifySender({ authResultsHeaders: [good], fromAddress: "security@mail.instagram.com", trustedAuthservIds: [], services }).verification)
      .toBe("nao_verificado");
  });

  it("remetente falsificado não recebe selo", () => {
    // Cabeçalho inserido pelo remetente com outro authserv-id.
    const forged = "evil.example; dmarc=pass header.from=mail.instagram.com";
    expect(verifySender({ authResultsHeaders: [forged, good], fromAddress: "security@mail.instagram.com", trustedAuthservIds: trusted, services }).verification)
      .toBe("nao_verificado");
    // Nome de exibição "Instagram" com domínio diferente.
    const other = "mx.cloudflare.net; dmarc=pass header.from=instagram-security.com";
    expect(verifySender({ authResultsHeaders: [other], fromAddress: "no-reply@instagram-security.com", trustedAuthservIds: trusted, services }).verification)
      .toBe("nao_verificado");
    // DMARC falhou.
    const fail = "mx.cloudflare.net; dmarc=fail header.from=mail.instagram.com";
    expect(verifySender({ authResultsHeaders: [fail], fromAddress: "security@mail.instagram.com", trustedAuthservIds: trusted, services }).verification)
      .toBe("falhou");
    // DMARC passou para outro domínio (sem alinhamento com o From visível).
    const misaligned = "mx.cloudflare.net; dmarc=pass header.from=attacker.com";
    expect(verifySender({ authResultsHeaders: [misaligned], fromAddress: "security@mail.instagram.com", trustedAuthservIds: trusted, services }).verification)
      .toBe("nao_verificado");
  });
});

describe("HMAC", () => {
  const secret = "s".repeat(48);
  const id = "3f1c2b8e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
  const now = 1_800_000_000;

  it("aceita assinatura válida e rejeita ausente, inválida e expirada", async () => {
    const body = '{"a":1}';
    const signature = await sign(secret, String(now), id, body);
    const h = { timestamp: String(now), eventId: id, signature };
    expect(await verifySignature(h, body, { secrets: [secret], nowSeconds: now })).toEqual({ ok: true });
    expect(await verifySignature({ ...h, signature: null }, body, { secrets: [secret], nowSeconds: now })).toMatchObject({ reason: "cabecalhos_ausentes" });
    expect(await verifySignature(h, body + " ", { secrets: [secret], nowSeconds: now })).toMatchObject({ reason: "assinatura_invalida" });
    expect(await verifySignature(h, body, { secrets: [secret], nowSeconds: now + 301 })).toMatchObject({ reason: "fora_da_janela" });
    expect(await verifySignature(h, body, { secrets: ["x".repeat(48)], nowSeconds: now })).toMatchObject({ reason: "assinatura_invalida" });
  });

  it("aceita o segredo anterior durante a rotação", async () => {
    const old = "o".repeat(48);
    const signature = await sign(old, String(now), id, "x");
    expect(await verifySignature({ timestamp: String(now), eventId: id, signature }, "x", { secrets: [secret, old], nowSeconds: now }))
      .toEqual({ ok: true });
  });

  it("ignora segredos curtos demais", async () => {
    const signature = await sign("curto", String(now), id, "x");
    expect(await verifySignature({ timestamp: String(now), eventId: id, signature }, "x", { secrets: ["curto"], nowSeconds: now }))
      .toMatchObject({ ok: false });
  });
});

describe("HTML para texto", () => {
  it("remove conteúdo ativo e nunca devolve marcação", () => {
    const html = `<html><head><style>p{}</style><script>alert(1)</script></head><body>
      <p>Olá&nbsp;Mundo &amp; amigos</p><img src="https://track.example/pixel.gif" onerror="alert(2)">
      <form action="https://evil"><input value="x"></form><a href="javascript:alert(3)">Clique</a>
      &lt;script&gt;alert(4)&lt;/script&gt;</body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Olá Mundo & amigos");
    expect(text).toContain("Clique");
    expect(text).not.toMatch(/alert\(1\)|alert\(2\)|pixel\.gif|javascript:|<img|<a |onerror/);
  });
});

describe("validação do payload", () => {
  it("rejeita formatos inválidos", () => {
    expect(validatePayload(null).ok).toBe(false);
    expect(validatePayload({ version: 2 }).ok).toBe(false);
  });
});
