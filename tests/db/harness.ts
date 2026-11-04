import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

/** Banco PostgreSQL real (PGlite/WASM) com as migrations do projeto. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-stub.sql"), "utf8"));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    // pg_cron não existe no PGlite; a limpeza é chamada diretamente nos testes.
    if (file.includes("_cron")) continue;
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return db;
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const res = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  return res.rows[0]!.id;
}

export async function makeAdmin(db: PGlite, email: string): Promise<void> {
  await db.query("select private.grant_admin($1)", [email]);
}

type Fn<T> = (tx: Transaction) => Promise<T>;

export async function asUser<T>(db: PGlite, userId: string, fn: Fn<T>, aal: "aal1" | "aal2" = "aal1"): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", aal }),
    ]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

export async function asAnon<T>(db: PGlite, fn: Fn<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    await tx.exec("set local role anon");
    return fn(tx);
  });
}

export async function asService<T>(db: PGlite, fn: Fn<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    await tx.exec("set local role service_role");
    return fn(tx);
  });
}

export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const message = (err as Error).message;
    if (!pattern.test(message)) throw new Error(`Erro inesperado: ${message}`);
    return;
  }
  throw new Error(`Era esperado erro ${pattern}`);
}

/** Chama ingest_message como service_role (igual à Edge Function). */
export async function ingest(db: PGlite, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return asService(db, async (tx) => {
    const res = await tx.query<{ r: Record<string, unknown> }>("select public.ingest_message($1::jsonb) as r", [
      JSON.stringify(payload),
    ]);
    return res.rows[0]!.r;
  });
}
