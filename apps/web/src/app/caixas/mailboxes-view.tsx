"use client";

import Link from "next/link";
import { useState } from "react";
import { LOCAL_PART_ERROR_MESSAGES, validateLocalPart } from "@inboxnexo/core";
import { Alert, Button, Card, CopyButton, EmptyState, Input, Label, Spinner } from "@/components/ui";
import { api } from "@/lib/client";
import { usePolling } from "@/lib/hooks";

interface Mailbox {
  id: string;
  local_part: string;
  domain: string;
  status: "active" | "disabled";
  created_at: string;
  message_count: number;
  unread_count: number;
  support_until: string | null;
}

export function MailboxesView({ domain, maxMailboxes, retentionSeconds }: { domain: string; maxMailboxes: number; retentionSeconds: number }) {
  const { data, error, loading, refresh } = usePolling(() => api<{ mailboxes: Mailbox[] }>("/api/mailboxes"));
  const [localPart, setLocalPart] = useState("");
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mailboxes = data?.mailboxes ?? [];
  const filtered = mailboxes.filter((m) => m.local_part.includes(search.trim().toLowerCase()));

  async function create(random: boolean) {
    setFormError(null);
    setNotice(null);
    const value = random ? null : localPart.trim().toLowerCase();
    if (!random) {
      const invalid = validateLocalPart(value ?? "");
      if (invalid) return setFormError(LOCAL_PART_ERROR_MESSAGES[invalid]);
    }
    setBusy(true);
    try {
      const res = await api<{ mailbox: { local_part: string } }>("/api/mailboxes", { method: "POST", body: { localPart: value } });
      setLocalPart("");
      setNotice(`Caixa ${res.mailbox.local_part}@${domain} criada.`);
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, success: string) {
    setNotice(null);
    setFormError(null);
    try {
      await fn();
      setNotice(success);
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Minhas caixas</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Mensagens ficam disponíveis por {Math.round(retentionSeconds / 60)} minutos após o recebimento e depois são excluídas.
          Limite da conta: {maxMailboxes} caixas.
        </p>
      </div>

      <Card>
        <h2 className="font-medium">Criar caixa</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="local">Identificador</Label>
            <div className="flex items-center gap-2">
              <Input id="local" placeholder="ex.: minhaloja" value={localPart} maxLength={32} onChange={(e) => setLocalPart(e.target.value)} />
              <span className="whitespace-nowrap text-sm text-slate-500">@{domain}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => create(false)} disabled={busy || !localPart.trim()}>Criar</Button>
            <Button variant="secondary" onClick={() => create(true)} disabled={busy}>Gerar aleatório</Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          3 a 32 caracteres: letras minúsculas, números, ponto, hífen e sublinhado. Endereços excluídos não podem ser reutilizados.
          Mensagens para <code>identificador+qualquer@{domain}</code> chegam na caixa <code>identificador</code>.
        </p>
      </Card>

      {formError && <Alert>{formError}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert kind="warning">Falha ao atualizar a lista: {error}</Alert>}

      <div className="flex items-center justify-between gap-3">
        <Input placeholder="Pesquisar caixas" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <span className="text-xs text-slate-500">{mailboxes.length} de {maxMailboxes}</span>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState title={mailboxes.length === 0 ? "Nenhuma caixa ainda" : "Nenhuma caixa encontrada"}>
          {mailboxes.length === 0 && "Crie sua primeira caixa acima."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {filtered.map((m) => {
            const address = `${m.local_part}@${m.domain}`;
            return (
              <li key={m.id}>
                <Card className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/caixas/${m.id}`} className="block truncate font-mono text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                        {address}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {m.message_count} mensagem(ns) · {m.unread_count} não lida(s)
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${m.status === "active" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"}`}>
                      {m.status === "active" ? "Ativa" : "Desativada"}
                    </span>
                  </div>
                  {m.support_until && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Suporte autorizado até {new Date(m.support_until).toLocaleString("pt-BR")}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap gap-2">
                    <CopyButton value={address} label="Copiar endereço" />
                    <Link href={`/caixas/${m.id}`} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500">
                      Abrir
                    </Link>
                    <Button
                      small
                      variant="secondary"
                      onClick={() =>
                        act(
                          () => api(`/api/mailboxes/${m.id}`, { method: "PATCH", body: { status: m.status === "active" ? "disabled" : "active" } }),
                          m.status === "active" ? "Caixa desativada: novas mensagens serão recusadas." : "Caixa reativada.",
                        )
                      }
                    >
                      {m.status === "active" ? "Desativar" : "Ativar"}
                    </Button>
                    {m.support_until ? (
                      <Button small variant="ghost" onClick={() => act(() => api(`/api/mailboxes/${m.id}/support`, { method: "DELETE" }), "Acesso de suporte revogado.")}>
                        Revogar suporte
                      </Button>
                    ) : (
                      <Button
                        small
                        variant="ghost"
                        title="Permite que a administração leia as mensagens desta caixa por 1 hora (auditado)."
                        onClick={() => {
                          if (confirm("Autorizar o suporte a ler as mensagens desta caixa por 1 hora? O acesso é registrado em auditoria.")) {
                            void act(() => api(`/api/mailboxes/${m.id}/support`, { method: "POST", body: { hours: 1 } }), "Suporte autorizado por 1 hora.");
                          }
                        }}
                      >
                        Autorizar suporte
                      </Button>
                    )}
                    <Button
                      small
                      variant="danger"
                      onClick={() => {
                        if (confirm(`Excluir ${address}? As mensagens serão apagadas e o endereço não poderá ser reutilizado.`)) {
                          void act(() => api(`/api/mailboxes/${m.id}`, { method: "DELETE" }), "Caixa excluída.");
                        }
                      }}
                    >
                      Excluir
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
