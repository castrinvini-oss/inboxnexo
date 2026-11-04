import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/header";
import { loadAccount } from "@/lib/account";
import { AdminView } from "./admin-view";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const account = await loadAccount();
  if (!account.has_admin_role) notFound();
  // MFA obrigatório para administradores (o banco também exige aal2).
  if (account.aal !== "aal2") redirect("/mfa?next=/admin");
  return (
    <>
      <AppHeader email={account.email} isAdmin />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <AdminView selfId={account.id} />
      </main>
    </>
  );
}
