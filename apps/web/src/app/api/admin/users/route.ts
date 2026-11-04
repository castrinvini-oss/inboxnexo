import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { assertSameOrigin, fail, fromDbError, ok, parseBody, rateLimit } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const search = new URL(request.url).searchParams.get("q")?.slice(0, 100) || null;
  const { data, error } = await auth.session.supabase.rpc("admin_list_users", { p_search: search });
  if (error) return fromDbError(error);
  return ok({ users: data });
}

const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });

/** Convite administrativo (cadastro público fica desativado). */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, z.union([inviteSchema, z.object({ generate: z.literal(true) })]));
  if ("error" in body) return body.error;

  if ("generate" in body.data) {
    const limited = await rateLimit(`generate:${auth.session.userId}`, 3600, 30);
    if (limited) return limited;
    const email = `usuario-${randomBytes(8).toString("hex")}@login.inboxnexo.invalid`;
    const password = randomBytes(24).toString("base64url") + "aA1!";
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return fail(400, "criacao_falhou", "Não foi possível criar a conta.");
    await admin.rpc("record_audit", { p_actor: auth.session.userId, p_action: "admin.create", p_target_type: "user", p_target_id: data.user.id, p_details: {} });
    return ok({ email, password }, 201);
  }
  // O convite precisa ir para um e-mail externo e permanente, nunca para uma
  // caixa temporária do próprio domínio (que expira e não recupera acesso).
  if (body.data.email.endsWith(`@${serverEnv.mailDomain}`)) {
    return fail(400, "email_temporario", "Use um e-mail externo e permanente, não uma caixa do InboxNexo.");
  }
  const limited = await rateLimit(`invite:${auth.session.userId}`, 3600, 30);
  if (limited) return limited;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(body.data.email, {
    redirectTo: `${serverEnv.appUrl}/auth/confirm`,
  });
  if (error) return fail(400, "convite_falhou", "Não foi possível enviar o convite. Verifique se o usuário já existe e se o SMTP do Supabase Auth está configurado.");
  await admin.rpc("record_audit", {
    p_actor: auth.session.userId,
    p_action: "admin.invite",
    p_target_type: "user",
    p_target_id: data.user?.id ?? null,
    p_details: {},
  });
  return ok({ userId: data.user?.id ?? null }, 201);
}

export async function DELETE(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const body = await parseBody(request, z.object({ id: z.string().uuid(), email: z.string().email() }));
  if ("error" in body) return body.error;
  const { id, email } = body.data;
  const { data, error } = await auth.session.supabase.rpc("admin_list_users", { p_search: email });
  if (error) return fromDbError(error);
  const user = data?.find((u: { id: string }) => u.id === id);
  if (!user || user.is_admin || id === auth.session.userId) return fail(403, "acesso_negado");
  if (Number(user.mailbox_count) > 0) return fail(409, "caixas_existentes", "Exclua primeiro as caixas deste usuário.");
  const admin = createAdminClient();
  const removed = await admin.auth.admin.deleteUser(id);
  if (removed.error) return fail(400, "exclusao_falhou", "Não foi possível excluir a conta.");
  await admin.rpc("record_audit", { p_actor: auth.session.userId, p_action: "admin.delete", p_target_type: "user", p_target_id: id, p_details: {} });
  return ok({ deleted: true });
}
