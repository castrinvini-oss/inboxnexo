import { AppHeader } from "@/components/header";
import { loadAccount } from "@/lib/account";
import { MailboxesView } from "./mailboxes-view";

export const dynamic = "force-dynamic";

export default async function MailboxesPage() {
  const account = await loadAccount();
  return (
    <>
      <AppHeader email={account.email} isAdmin={account.has_admin_role} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <MailboxesView domain={account.mail_domain} maxMailboxes={account.max_mailboxes} retentionSeconds={account.retention_seconds} />
      </main>
    </>
  );
}
