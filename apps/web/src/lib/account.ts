import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./auth";

export interface Account {
  id: string;
  email: string;
  disabled: boolean;
  has_admin_role: boolean;
  aal: string;
  mail_domain: string;
  retention_seconds: number;
  max_mailboxes: number;
  max_messages_per_hour: number;
  mailbox_count: number;
}

/** Usado pelas páginas protegidas (Server Components). */
export async function loadAccount(): Promise<Account> {
  const session = await getSession();
  if (!session) redirect("/login");
  const { data, error } = await session.supabase.rpc("my_account");
  if (error || !data) redirect("/login");
  const account = data as Account;
  if (account.disabled) redirect("/login");
  return account;
}
