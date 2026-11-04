import { AppHeader } from "@/components/header";
import { loadAccount } from "@/lib/account";
import { AddressesView } from "./addresses-view";

export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const account = await loadAccount();
  return (
    <>
      <AppHeader email={account.email} isAdmin={account.has_admin_role} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <AddressesView domain={account.mail_domain} initialCount={account.mailbox_count} maxMailboxes={account.max_mailboxes} />
      </main>
    </>
  );
}
