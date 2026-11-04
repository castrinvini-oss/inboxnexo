import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createDb, createUser, expectDbError } from "./harness.ts";

let db: PGlite;
let ana: string;
let beto: string;

beforeAll(async () => {
  db = await createDb();
  ana = await createUser(db, "ana@externo.test");
  beto = await createUser(db, "beto@externo.test");
  await asUser(db, ana, (tx) => tx.query("select public.create_mailbox('antonella')"));
  await asUser(db, beto, (tx) => tx.query("select public.create_mailbox('bianca')"));
  const id = await asUser(db, beto, async (tx) => (await tx.query<{ id: string }>("select id from public.create_mailbox('kiara')")).rows[0]!.id);
  await asUser(db, beto, (tx) => tx.query("select public.delete_mailbox($1)", [id]));
});

async function check(userId: string, names: string[]) {
  const r = await asUser(db, userId, (tx) =>
    tx.query<{ local_part: string; status: string }>("select * from public.check_local_parts($1::text[])", [names]),
  );
  return Object.fromEntries(r.rows.map((x) => [x.local_part, x.status]));
}

describe("check_local_parts (aba Endereços)", () => {
  it("classifica disponibilidade sem criar caixas", async () => {
    const before = await db.query<{ n: number }>("select count(*)::int as n from public.mailboxes");
    const result = await check(ana, ["antonella", "bianca", "kiara", "lavinia", "admin", "a..b", "Rafaela"]);
    expect(result).toEqual({
      antonella: "sua_caixa",
      bianca: "em_uso",
      kiara: "em_uso", // excluída: nunca reutilizada
      lavinia: "disponivel",
      admin: "reservado",
      "a..b": "invalido",
      rafaela: "disponivel",
    });
    const after = await db.query<{ n: number }>("select count(*)::int as n from public.mailboxes");
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("exige usuário autenticado e limita o tamanho da lista", async () => {
    await expectDbError(asAnon(db, (tx) => tx.query("select * from public.check_local_parts(array['x'])")), /permission denied/);
    const big = Array.from({ length: 201 }, (_, i) => `nome${i}`);
    await expectDbError(asUser(db, ana, (tx) => tx.query("select * from public.check_local_parts($1::text[])", [big])), /parametros_invalidos/);
  });

  it("criação individual respeita o limite de 5 caixas", async () => {
    const u = await createUser(db, "limite5@externo.test");
    for (const name of ["rafaela", "lavinia", "sofia", "giulia", "bella"]) {
      await asUser(db, u, (tx) => tx.query("select public.create_mailbox($1)", [name]));
    }
    await expectDbError(asUser(db, u, (tx) => tx.query("select public.create_mailbox('chiara')")), /limite_caixas/);
    const persisted = await db.query<{ n: number }>(
      "select count(*)::int as n from public.mailboxes where owner_id = $1 and status = 'active'", [u],
    );
    expect(persisted.rows[0]!.n).toBe(5);
    expect((await check(u, ["chiara"])).chiara).toBe("disponivel");
  });
});
