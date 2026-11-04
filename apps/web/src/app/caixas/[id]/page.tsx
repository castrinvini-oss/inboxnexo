import { notFound } from "next/navigation";
import { AppHeader } from "@/components/header";
import { loadAccount } from "@/lib/account";
import { InboxView } from "./inbox-view";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const account = await loadAccount();
  return (
    <>
      <AppHeader email={account.email} isAdmin={account.has_admin_role} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <InboxView mailboxId={id} />
      </main>
    </>
  );
}
