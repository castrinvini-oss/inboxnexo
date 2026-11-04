import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asService, asUser, createDb, createUser, expectDbError, ingest, makeAdmin } from "./harness.ts";

const hex = (n: number) => n.toString(16).padStart(64, "0");
let seq = 0;
function payload(localPart: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    version: 1,
    eventId: randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
    recipient: { localPart, tag: null },
    dedupKey: hex(seq),
    fromAddress: "remetente@example.com",
    fromName: "Remetente",
    subject: `Assunto ${seq}`,
    textBody: "Seu código de verificação é 012345",
    code: { status: "found", value: "012345", candidates: ["012345"], ruleId: "generic" },
    sender: { verification: "nao_verificado", serviceId: null },
    rawSize: 1000,
    ...overrides,
  };
}

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;
let aliceBox: string;
let bobBox: string;

beforeAll(async () => {
  db = await createDb();
  alice = await createUser(db, "alice@externo.test");
  bob = await createUser(db, "bob@externo.test");
  admin = await createUser(db, "admin@externo.test");
  await makeAdmin(db, "admin@externo.test");
  aliceBox = await asUser(db, alice, async (tx) => {
    const r = await tx.query<{ id: string }>("select id from public.create_mailbox('cliente01')");
    return r.rows[0]!.id;
  });
  bobBox = await asUser(db, bob, async (tx) => {
    const r = await tx.query<{ id: string }>("select id from public.create_mailbox('Cliente02')");
    return r.rows[0]!.id;
  });
});

describe("caixas", () => {
  it("normaliza o identificador no cadastro", async () => {
    const r = await asUser(db, bob, (tx) => tx.query<{ local_part: string }>("select local_part from public.mailboxes"));
    expect(r.rows.map((x) => x.local_part)).toEqual(["cliente02"]);
  });

  it("rejeita identificadores inválidos, reservados e duplicados", async () => {
    await expectDbError(asUser(db, alice, (tx) => tx.query("select public.create_mailbox('a+b')")), /identificador_invalido/);
    await expectDbError(asUser(db, alice, (tx) => tx.query("select public.create_mailbox('a..bc')")), /identificador_invalido/);
    await expectDbError(asUser(db, alice, (tx) => tx.query("select public.create_mailbox('postmaster')")), /identificador_reservado/);
    await expectDbError(asUser(db, alice, (tx) => tx.query("select public.create_mailbox('cliente02')")), /endereco_indisponivel/);
  });

  it("gera identificador aleatório quando não informado", async () => {
    const r = await asUser(db, alice, (tx) => tx.query<{ local_part: string }>("select local_part from public.create_mailbox(null)"));
    expect(r.rows[0]!.local_part).toMatch(/^[0-9a-f]{12}$/);
  });

  it("respeita o limite de caixas por usuário", async () => {
    const u = await createUser(db, "limite@externo.test");
    await db.query("update public.profiles set max_mailboxes = 1 where id = $1", [u]);
    await asUser(db, u, (tx) => tx.query("select public.create_mailbox('limite-a')"));
    await expectDbError(asUser(db, u, (tx) => tx.query("select public.create_mailbox('limite-b')")), /limite_caixas/);
  });

  it("não reutiliza endereço excluído para outro cliente", async () => {
    const u = await createUser(db, "ex@externo.test");
    const id = await asUser(db, u, async (tx) => (await tx.query<{ id: string }>("select id from public.create_mailbox('antigo01')")).rows[0]!.id);
    await asUser(db, u, (tx) => tx.query("select public.delete_mailbox($1)", [id]));
    await expectDbError(asUser(db, bob, (tx) => tx.query("select public.create_mailbox('antigo01')")), /endereco_indisponivel/);
  });

  it("usuário não altera caixa de outro usuário, mesmo informando o ID", async () => {
    await expectDbError(asUser(db, bob, (tx) => tx.query("select public.set_mailbox_status($1, 'disabled')", [aliceBox])), /caixa_nao_encontrada/);
    await expectDbError(asUser(db, bob, (tx) => tx.query("select public.delete_mailbox($1)", [aliceBox])), /caixa_nao_encontrada/);
  });

  it("não há escrita direta nas tabelas", async () => {
    await expectDbError(
      asUser(db, alice, (tx) => tx.query("insert into public.mailboxes (owner_id, local_part, domain) values ($1, 'direto', 'x')", [alice])),
      /permission denied/,
    );
    await expectDbError(asUser(db, alice, (tx) => tx.query("update public.mailboxes set owner_id = $1", [alice])), /permission denied/);
  });
});

describe("papéis administrativos", () => {
  it("usuário comum não consegue se promover", async () => {
    await expectDbError(
      asUser(db, alice, (tx) => tx.query("insert into private.user_roles (user_id, role, granted_by) values ($1, 'admin', 'x')", [alice])),
      /permission denied/,
    );
    await expectDbError(asUser(db, alice, (tx) => tx.query("select private.grant_admin('alice@externo.test')")), /permission denied/);
    await expectDbError(asUser(db, alice, (tx) => tx.query("select private.bootstrap_admin('alice@externo.test')")), /permission denied/);
    await expectDbError(asUser(db, alice, (tx) => tx.query("update public.profiles set disabled = false")), /permission denied/);
    await expectDbError(asUser(db, alice, (tx) => tx.query("select public.admin_list_users(null)")), /acesso_negado/);
  });

  it("bootstrap só funciona quando não há administrador", async () => {
    await expectDbError(db.query("select private.bootstrap_admin('bob@externo.test')"), /ja_existe_administrador/);
  });

  it("administrador sem MFA (aal1) não tem acesso administrativo", async () => {
    await expectDbError(asUser(db, admin, (tx) => tx.query("select public.admin_ops_status()"), "aal1"), /acesso_negado/);
    const r = await asUser(db, admin, (tx) => tx.query("select public.admin_ops_status() as s"), "aal2");
    expect(r.rows).toHaveLength(1);
  });

  it("administrador não lê mensagens sem autorização do proprietário", async () => {
    await expectDbError(
      asUser(db, admin, (tx) => tx.query("select * from public.admin_read_mailbox_messages($1)", [aliceBox]), "aal2"),
      /sem_autorizacao_do_proprietario/,
    );
    const direct = await asUser(db, admin, (tx) => tx.query("select * from public.messages where mailbox_id = $1", [aliceBox]), "aal2");
    expect(direct.rows).toHaveLength(0);
  });

  it("acesso administrativo autorizado é auditado", async () => {
    await ingest(db, payload("cliente01"));
    await asUser(db, alice, (tx) => tx.query("select public.grant_support_access($1, 1)", [aliceBox]));
    const r = await asUser(db, admin, (tx) => tx.query("select * from public.admin_read_mailbox_messages($1)", [aliceBox]), "aal2");
    expect(r.rows.length).toBeGreaterThan(0);
    const audit = await db.query<{ action: string; details: unknown }>(
      "select action, details from public.audit_log where action = 'admin.content_access'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]!.details)).not.toContain("012345");
    await asUser(db, alice, (tx) => tx.query("select public.revoke_support_access($1)", [aliceBox]));
  });
});

describe("ingestão", () => {
  it("mensagem para caixa cadastrada aparece somente na caixa correta", async () => {
    const res = await ingest(db, payload("cliente02", { subject: "para bob" }));
    expect(res.status).toBe("stored");
    const bobView = await asUser(db, bob, (tx) => tx.query<{ subject: string }>("select subject from public.messages"));
    expect(bobView.rows.map((r) => r.subject)).toContain("para bob");
    const aliceView = await asUser(db, alice, (tx) => tx.query<{ subject: string }>("select subject from public.messages"));
    expect(aliceView.rows.map((r) => r.subject)).not.toContain("para bob");
  });

  it("usuário A não acessa mensagens do usuário B alterando IDs", async () => {
    const bobMsg = await asUser(db, bob, async (tx) => (await tx.query<{ id: string }>("select id from public.messages limit 1")).rows[0]!.id);
    const read = await asUser(db, alice, (tx) => tx.query("select * from public.messages where id = $1", [bobMsg]));
    expect(read.rows).toHaveLength(0);
    const upd = await asUser(db, alice, (tx) => tx.query("update public.messages set read_at = now() where id = $1", [bobMsg]));
    expect(upd.affectedRows).toBe(0);
    const del = await asUser(db, alice, (tx) => tx.query("delete from public.messages where id = $1", [bobMsg]));
    expect(del.affectedRows).toBe(0);
    const stillThere = await db.query("select 1 from public.messages where id = $1", [bobMsg]);
    expect(stillThere.rows).toHaveLength(1);
    const anon = await asAnon(db, (tx) => tx.query("select * from public.messages").catch((e: Error) => e));
    expect(anon).toBeInstanceOf(Error);
  });

  it("usuário só altera read_at, nenhuma outra coluna", async () => {
    await expectDbError(asUser(db, bob, (tx) => tx.query("update public.messages set expires_at = now() + interval '9 hours'")), /permission denied/);
    await expectDbError(asUser(db, bob, (tx) => tx.query("update public.messages set subject = 'x'")), /permission denied/);
  });

  it("destinatário desconhecido não cria caixa", async () => {
    const before = await db.query<{ n: number }>("select count(*)::int as n from public.mailboxes");
    const res = await ingest(db, payload("naoexiste"));
    expect(res.status).toBe("unknown_mailbox");
    const after = await db.query<{ n: number }>("select count(*)::int as n from public.mailboxes");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("caixa desativada não armazena novo conteúdo", async () => {
    await asUser(db, bob, (tx) => tx.query("select public.set_mailbox_status($1, 'disabled')", [bobBox]));
    const res = await ingest(db, payload("cliente02"));
    expect(res.status).toBe("inactive_mailbox");
    await asUser(db, bob, (tx) => tx.query("select public.set_mailbox_status($1, 'active')", [bobBox]));
  });

  it("caixa excluída não recebe", async () => {
    const res = await ingest(db, payload("antigo01"));
    expect(res.status).toBe("inactive_mailbox");
  });

  it("replay do mesmo evento é rejeitado", async () => {
    const p = payload("cliente02");
    expect((await ingest(db, p)).status).toBe("stored");
    expect((await ingest(db, p)).status).toBe("replay");
  });

  it("reentrega não duplica nem renova a validade", async () => {
    const p = payload("cliente02", { subject: "reentrega" });
    expect((await ingest(db, p)).status).toBe("stored");
    await db.query("update public.messages set received_at = now() - interval '30 minutes', expires_at = now() + interval '30 minutes' where subject = 'reentrega'");
    const again = await ingest(db, { ...p, eventId: randomUUID() });
    expect(again.status).toBe("duplicate");
    const rows = await db.query<{ n: number; secs: number }>(
      "select count(*)::int as n, max(extract(epoch from expires_at - now()))::int as secs from public.messages where subject = 'reentrega'",
    );
    expect(rows.rows[0]!.n).toBe(1);
    expect(rows.rows[0]!.secs).toBeLessThanOrEqual(1800);
    // Mesmo depois de apagada, a chave opaca impede recriação por 24 h.
    await db.query("delete from public.messages where subject = 'reentrega'");
    expect((await ingest(db, { ...p, eventId: randomUUID() })).status).toBe("duplicate");
  });

  it("expires_at = received_at + 1 hora pelo relógio do banco", async () => {
    await ingest(db, payload("cliente02", { subject: "prazo" }));
    const r = await db.query<{ diff: number }>(
      "select extract(epoch from expires_at - received_at)::int as diff from public.messages where subject = 'prazo'",
    );
    expect(r.rows[0]!.diff).toBe(3600);
  });

  it("preserva zeros à esquerda do código", async () => {
    await ingest(db, payload("cliente02", { subject: "zero", code: { status: "found", value: "000123", candidates: ["000123"], ruleId: "generic" } }));
    const r = await asUser(db, bob, (tx) => tx.query<{ code: string }>("select code from public.messages where subject = 'zero'"));
    expect(r.rows[0]!.code).toBe("000123");
  });

  it("respeita limite de volume por hora", async () => {
    const u = await createUser(db, "volume@externo.test");
    await db.query("update public.profiles set max_messages_per_hour = 2 where id = $1", [u]);
    await asUser(db, u, (tx) => tx.query("select public.create_mailbox('volume01')"));
    expect((await ingest(db, payload("volume01"))).status).toBe("stored");
    expect((await ingest(db, payload("volume01"))).status).toBe("stored");
    expect((await ingest(db, payload("volume01"))).status).toBe("quota_exceeded");
  });

  it("ingestão pausada retorna paused", async () => {
    await db.query("update private.app_settings set ingest_paused = true");
    expect((await ingest(db, payload("cliente02"))).status).toBe("paused");
    await db.query("update private.app_settings set ingest_paused = false");
  });

  it("somente service_role executa ingest_message", async () => {
    await expectDbError(
      asUser(db, alice, (tx) => tx.query("select public.ingest_message($1::jsonb)", [JSON.stringify(payload("cliente01"))])),
      /permission denied/,
    );
    await expectDbError(asAnon(db, (tx) => tx.query("select public.ingest_message('{}'::jsonb)")), /permission denied/);
  });

  it("service_role não acessa tabelas privadas diretamente", async () => {
    await expectDbError(asService(db, (tx) => tx.query("select * from private.user_roles")), /permission denied/);
  });
});

describe("expiração e limpeza", () => {
  it("mensagem vencida fica inacessível mesmo sem limpeza", async () => {
    await ingest(db, payload("cliente02", { subject: "vencida" }));
    await db.query(
      "update public.messages set received_at = now() - interval '61 minutes', expires_at = now() - interval '1 minute' where subject = 'vencida'",
    );
    const view = await asUser(db, bob, (tx) => tx.query("select * from public.messages where subject = 'vencida'"));
    expect(view.rows).toHaveLength(0);
    const overview = await asUser(db, bob, (tx) => tx.query<{ message_count: number }>("select message_count::int from public.mailbox_overview"));
    const physical = await db.query("select 1 from public.messages where subject = 'vencida'");
    expect(physical.rows).toHaveLength(1);
    const visible = await asUser(db, bob, (tx) => tx.query<{ n: number }>("select count(*)::int as n from public.messages"));
    expect(overview.rows[0]!.message_count).toBe(visible.rows[0]!.n);
  });

  it("limpeza remove vencidas e preserva as recentes, sem tocar em caixas e usuários", async () => {
    await ingest(db, payload("cliente02", { subject: "recente" }));
    const result = await db.query<{ r: { deleted_messages: number } }>("select private.purge_expired(2, 50) as r");
    expect(result.rows[0]!.r.deleted_messages).toBeGreaterThanOrEqual(1);
    const left = await db.query("select 1 from public.messages where expires_at <= now()");
    expect(left.rows).toHaveLength(0);
    const recent = await db.query("select 1 from public.messages where subject = 'recente'");
    expect(recent.rows).toHaveLength(1);
    const boxes = await db.query("select 1 from public.mailboxes where id = $1", [bobBox]);
    expect(boxes.rows).toHaveLength(1);
    const run = await db.query("select * from private.maintenance_runs where job = 'purge_expired'");
    expect(run.rows.length).toBeGreaterThan(0);
  });

  it("auditoria não contém conteúdo de mensagens", async () => {
    const r = await db.query<{ t: string }>("select coalesce(string_agg(details::text || action, ' '), '') as t from public.audit_log");
    expect(r.rows[0]!.t).not.toMatch(/012345|Assunto|remetente@example.com/);
  });
});
