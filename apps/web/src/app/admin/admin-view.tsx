"use client";

import { useState } from "react";
import { Alert, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { formatTime, usePolling } from "@/lib/hooks";
import { AdminSupportReader } from "./support-reader";

interface OpsStatus {
  mail_domain: string;
  ingest_paused: boolean;
  retention_seconds: number;
  default_max_mailboxes: number;
  default_max_messages_per_hour: number;
  last_purge_at: string | null;
  last_purge_deleted: number | null;
  expired_pending: number;
  oldest_expired_seconds: number | null;
  active_messages: number;
  users: number;
  mailboxes_active: number;
  mailboxes_disabled: number;
  ingest_last_hour: Record<string, number> | null;
}

interface AdminUser {
  id: string;
  email: string;
  disabled: boolean;
  is_admin: boolean;
  max_mailboxes: number | null;
  max_messages_per_hour: number | null;
  mailbox_count: number;
  created_at: string;
}

interface AdminMailbox {
  id: string;
  local_part: string;
  domain: string;
  status: string;
  owner_email: string | null;
  created_at: string;
}

interface AuditEntry {
  id: number;
  at: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
}

type Tab = "status" | "usuarios" | "caixas" | "auditoria";

export function AdminView({ selfId }: { selfId: string }) {
  const [tab, setTab] = useState<Tab>("status");
  const tabs: [Tab, string][] = [["status", "Estado operacional"], ["usuarios", "Usuários"], ["caixas", "Caixas"], ["auditoria", "Auditoria"]];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Administração</h1>
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === id ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "status" && <StatusTab />}
      {tab === "usuarios" && <UsersTab selfId={selfId} />}
      {tab === "caixas" && <MailboxesTab />}
      {tab === "auditoria" && <AuditTab />}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <Card className={warn ? "border-amber-300 dark:border-amber-700" : ""}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </Card>
  );
}

function StatusTab() {
  const { data, error, loading, refresh } = usePolling(() => api<{ status: OpsStatus }>("/api/admin/status"), 15_000);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [defaults, setDefaults] = useState<{ boxes: string; perHour: string } | null>(null);

  if (loading && !data) return <Spinner />;
  if (!data) return <Alert>{error ?? "Falha ao carregar."}</Alert>;
  const s = data.status;
  const purgeLate = !s.last_purge_at || Date.now() - Date.parse(s.last_purge_at) > 5 * 60_000;

  async function save(body: Record<string, unknown>, text: string) {
    setMsg(null);
    try {
      await api("/api/admin/settings", { method: "PATCH", body: { ingestPaused: null, defaultMaxMailboxes: null, defaultMaxMessagesPerHour: null, ...body } });
      setMsg({ kind: "success", text });
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  const ingest = s.ingest_last_hour ?? {};
  return (
    <div className="space-y-5">
      {error && <Alert kind="warning">Falha na atualização: {error}</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {purgeLate && (
        <Alert kind="warning">
          A limpeza agendada não registrou execução nos últimos 5 minutos. As mensagens vencidas continuam inacessíveis, mas a exclusão física está atrasada. Verifique o Supabase Cron.
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Domínio" value={s.mail_domain} />
        <Stat label="Recebimento" value={s.ingest_paused ? "Pausado" : "Habilitado no banco"} warn={s.ingest_paused} />
        <Stat label="Mensagens ativas" value={s.active_messages} />
        <Stat label="Vencidas aguardando exclusão" value={s.expired_pending} warn={s.expired_pending > 0 && purgeLate} />
        <Stat label="Última limpeza" value={s.last_purge_at ? `${formatTime(s.last_purge_at)} (${s.last_purge_deleted ?? 0})` : "Nunca"} warn={purgeLate} />
        <Stat label="Usuários" value={s.users} />
        <Stat label="Caixas ativas / desativadas" value={`${s.mailboxes_active} / ${s.mailboxes_disabled}`} />
        <Stat label="Retenção" value={`${Math.round(s.retention_seconds / 60)} min`} />
      </div>
      <Card>
        <h2 className="font-medium">Ingestão na última hora</h2>
        <p className="mt-1 text-xs text-slate-500">Contagem de eventos processados pela Edge Function. “Habilitado no banco” não comprova que o DNS e o Email Routing estejam ativos.</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {Object.keys(ingest).length === 0 ? (
            <span className="text-slate-500">Nenhum evento registrado.</span>
          ) : (
            Object.entries(ingest).map(([k, v]) => (
              <span key={k} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs dark:bg-slate-800">{k}: {v}</span>
            ))
          )}
        </div>
      </Card>
      <Card className="space-y-4">
        <h2 className="font-medium">Controles</h2>
        <Button
          variant={s.ingest_paused ? "primary" : "danger"}
          onClick={() => {
            const pause = !s.ingest_paused;
            if (!pause || confirm("Pausar o recebimento? O Worker devolverá falha temporária para novas mensagens.")) {
              void save({ ingestPaused: pause }, pause ? "Recebimento pausado." : "Recebimento retomado.");
            }
          }}
        >
          {s.ingest_paused ? "Retomar recebimento" : "Pausar recebimento"}
        </Button>
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div>
            <Label htmlFor="dboxes">Limite padrão de caixas</Label>
            <Input id="dboxes" type="number" min={0} max={1000} value={defaults?.boxes ?? String(s.default_max_mailboxes)} onChange={(e) => setDefaults({ boxes: e.target.value, perHour: defaults?.perHour ?? String(s.default_max_messages_per_hour) })} />
          </div>
          <div>
            <Label htmlFor="dhour">Mensagens por hora (padrão)</Label>
            <Input id="dhour" type="number" min={0} max={10000} value={defaults?.perHour ?? String(s.default_max_messages_per_hour)} onChange={(e) => setDefaults({ boxes: defaults?.boxes ?? String(s.default_max_mailboxes), perHour: e.target.value })} />
          </div>
          <Button
            variant="secondary"
            disabled={!defaults}
            onClick={() =>
              defaults &&
              void save({ defaultMaxMailboxes: Number(defaults.boxes), defaultMaxMessagesPerHour: Number(defaults.perHour) }, "Limites padrão atualizados.").then(() => setDefaults(null))
            }
          >
            Salvar limites padrão
          </Button>
        </div>
      </Card>
    </div>
  );
}

function UsersTab({ selfId }: { selfId: string }) {
  const [q, setQ] = useState("");
  const { data, error, loading, refresh } = usePolling(() => api<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`), 30_000);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function manage(user?: AdminUser) {
    if (busy || (user && !confirm(`Excluir permanentemente a conta de ${user.email}?`))) return;
    setBusy(true);
    setMsg(null);
    setCredentials(null);
    try {
      if (user) {
        await api("/api/admin/users", { method: "DELETE", body: { id: user.id, email: user.email } });
        setMsg({ kind: "success", text: "Conta excluída." });
      } else {
        setCredentials(await api<{ email: string; password: string }>("/api/admin/users", { method: "POST", body: { generate: true } }));
      }
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api("/api/admin/users", { method: "POST", body: { email } });
      setMsg({ kind: "success", text: `Convite enviado para ${email}.` });
      setEmail("");
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  async function update(u: AdminUser, patch: Partial<{ maxMailboxes: number | null; maxMessagesPerHour: number | null; disabled: boolean }>) {
    setMsg(null);
    try {
      await api(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: { maxMailboxes: u.max_mailboxes, maxMessagesPerHour: u.max_messages_per_hour, disabled: u.disabled, ...patch },
      });
      setMsg({ kind: "success", text: "Usuário atualizado." });
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  function askNumber(label: string, current: number | null): number | null | undefined {
    const value = prompt(`${label} (vazio = padrão do sistema)`, current === null ? "" : String(current));
    if (value === null) return undefined;
    if (value.trim() === "") return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }

  return (
    <div className="space-y-5">
      <Card>
        <Button disabled={busy} onClick={() => void manage()}>Gerar usuário e senha</Button>
        {credentials && <div className="my-3 space-y-1" aria-live="polite">
          <p>Copie os dados para entrar no painel. A senha aparece uma única vez.</p>
          <p>Login: <code>{credentials.email}</code></p>
          <p>Senha: <code>{credentials.password}</code></p>
          <Button small variant="secondary" onClick={() => setCredentials(null)}>Ocultar</Button>
        </div>}
        <form onSubmit={invite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="invite">Convidar usuário (e-mail externo e permanente)</Label>
            <Input id="invite" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit">Enviar convite</Button>
        </form>
      </Card>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="warning">{error}</Alert>}
      <div className="flex gap-2">
        <Input placeholder="Pesquisar por e-mail" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button variant="secondary" onClick={() => void refresh()}>Pesquisar</Button>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
              <tr><th className="p-3">E-mail</th><th className="p-3">Caixas</th><th className="p-3">Limite caixas</th><th className="p-3">Msg/hora</th><th className="p-3">Estado</th><th className="p-3">Ações</th></tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-3">{u.email}{u.is_admin && <span className="ml-2 rounded bg-indigo-100 px-1.5 text-xs text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">admin</span>}</td>
                  <td className="p-3">{u.mailbox_count}</td>
                  <td className="p-3">{u.max_mailboxes ?? "padrão"}</td>
                  <td className="p-3">{u.max_messages_per_hour ?? "padrão"}</td>
                  <td className="p-3">{u.disabled ? "Desativado" : "Ativo"}</td>
                  <td className="space-x-1 p-3 whitespace-nowrap">
                    <Button small variant="secondary" onClick={() => { const v = askNumber("Limite de caixas", u.max_mailboxes); if (v !== undefined) void update(u, { maxMailboxes: v }); }}>Caixas</Button>
                    <Button small variant="secondary" onClick={() => { const v = askNumber("Mensagens por hora", u.max_messages_per_hour); if (v !== undefined) void update(u, { maxMessagesPerHour: v }); }}>Volume</Button>
                    {u.id !== selfId && !u.is_admin && <Button small variant="danger" disabled={busy} onClick={() => void manage(u)}>Excluir</Button>}
                    {u.id !== selfId && (
                      <Button small variant={u.disabled ? "primary" : "danger"} onClick={() => { if (u.disabled || confirm(`Desativar ${u.email}? O login será bloqueado.`)) void update(u, { disabled: !u.disabled }); }}>
                        {u.disabled ? "Reativar" : "Desativar"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">Papéis administrativos são concedidos apenas pelo procedimento controlado em SQL (docs/ADMINISTRADOR.md).</p>
    </div>
  );
}

function MailboxesTab() {
  const [q, setQ] = useState("");
  const { data, error, loading, refresh } = usePolling(() => api<{ mailboxes: AdminMailbox[] }>(`/api/admin/mailboxes?q=${encodeURIComponent(q)}`), 30_000);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [reading, setReading] = useState<AdminMailbox | null>(null);

  async function run(fn: () => Promise<unknown>, text: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: "success", text });
      await refresh();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  return (
    <div className="space-y-5">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="warning">{error}</Alert>}
      <div className="flex gap-2">
        <Input placeholder="Pesquisar por identificador ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button variant="secondary" onClick={() => void refresh()}>Pesquisar</Button>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
              <tr><th className="p-3">Endereço</th><th className="p-3">Proprietário</th><th className="p-3">Estado</th><th className="p-3">Ações</th></tr>
            </thead>
            <tbody>
              {(data?.mailboxes ?? []).map((m) => (
                <tr key={m.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-3 font-mono text-xs">{m.local_part}@{m.domain}</td>
                  <td className="p-3">{m.owner_email ?? "—"}</td>
                  <td className="p-3">{m.status === "active" ? "Ativa" : m.status === "disabled" ? "Desativada" : "Excluída (reservada)"}</td>
                  <td className="space-x-1 p-3 whitespace-nowrap">
                    {m.status !== "deleted" && (
                      <>
                        <Button small variant="secondary" onClick={() => void run(() => api(`/api/admin/mailboxes/${m.id}`, { method: "PATCH", body: { status: m.status === "active" ? "disabled" : "active" } }), "Caixa atualizada.")}>
                          {m.status === "active" ? "Desativar" : "Ativar"}
                        </Button>
                        <Button small variant="ghost" onClick={() => setReading(m)}>Suporte</Button>
                        <Button small variant="danger" onClick={() => { if (confirm("Excluir esta caixa? O endereço ficará reservado.")) void run(() => api(`/api/admin/mailboxes/${m.id}`, { method: "DELETE" }), "Caixa excluída."); }}>Excluir</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reading && <AdminSupportReader mailbox={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

function AuditTab() {
  const { data, error, loading } = usePolling(() => api<{ entries: AuditEntry[] }>("/api/admin/audit"), 30_000);
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-3">
      {error && <Alert kind="warning">{error}</Alert>}
      <p className="text-xs text-slate-500">A auditoria registra ações administrativas sem conteúdo de mensagens. Retenção: 180 dias.</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 uppercase text-slate-500 dark:bg-slate-800">
            <tr><th className="p-2">Quando</th><th className="p-2">Ação</th><th className="p-2">Alvo</th><th className="p-2">Ator</th><th className="p-2">Detalhes</th></tr>
          </thead>
          <tbody>
            {(data?.entries ?? []).map((e) => (
              <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-2 whitespace-nowrap">{new Date(e.at).toLocaleString("pt-BR")}</td>
                <td className="p-2 font-mono">{e.action}</td>
                <td className="p-2 font-mono">{e.target_type}:{e.target_id?.slice(0, 8) ?? "—"}</td>
                <td className="p-2 font-mono">{e.actor_id?.slice(0, 8) ?? "sistema"}</td>
                <td className="p-2 font-mono">{JSON.stringify(e.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

