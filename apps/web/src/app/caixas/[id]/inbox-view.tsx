"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CodePanel, Countdown, VerificationBadge } from "@/components/message-parts";
import { Alert, Button, Card, CopyButton, EmptyState, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/client";
import { formatTime, serverOffset, useNow, usePolling } from "@/lib/hooks";

interface MessageSummary {
  id: string;
  from_address: string | null;
  from_name: string | null;
  subject: string;
  code: string | null;
  code_status: string;
  sender_verification: string;
  sender_service: string | null;
  received_at: string;
  expires_at: string;
  read_at: string | null;
}

interface MessageDetail extends MessageSummary {
  text_body: string;
  code_candidates: string[];
  recipient_tag: string | null;
}

interface ListResponse {
  mailbox: { id: string; local_part: string; domain: string; status: string };
  messages: MessageSummary[];
  now: string;
}

export function InboxView({ mailboxId }: { mailboxId: string }) {
  const [offset, setOffset] = useState(0);
  const { data, setData, error, loading, refresh } = usePolling(async () => {
    const res = await api<ListResponse>(`/api/mailboxes/${mailboxId}/messages`);
    setOffset(serverOffset(res.now));
    return res;
  });
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const clientNow = useNow();
  const now = clientNow + offset;

  // Retira da tela tudo que expirou, mesmo antes da próxima atualização.
  const messages = useMemo(
    () => (data?.messages ?? []).filter((m) => Date.parse(m.expires_at) > now),
    [data, now],
  );
  useEffect(() => {
    if (selected && Date.parse(selected.expires_at) <= now) {
      setSelected(null);
      setDetailError("A mensagem expirou e foi removida.");
    }
  }, [selected, now]);

  async function open(id: string) {
    setDetailError(null);
    setActionError(null);
    try {
      const res = await api<{ message: MessageDetail }>(`/api/messages/${id}`);
      setSelected(res.message);
      if (!res.message.read_at) {
        await api(`/api/messages/${id}`, { method: "PATCH", body: { read: true } });
        setData((d) => (d ? { ...d, messages: d.messages.map((m) => (m.id === id ? { ...m, read_at: new Date().toISOString() } : m)) } : d));
      }
    } catch (err) {
      setSelected(null);
      setDetailError(err instanceof ApiError && err.status === 404 ? "Mensagem não encontrada ou expirada." : (err as Error).message);
    }
  }

  async function toggleRead(m: MessageSummary) {
    setActionError(null);
    try {
      const res = await api<{ message: { read_at: string | null } }>(`/api/messages/${m.id}`, { method: "PATCH", body: { read: !m.read_at } });
      setSelected((s) => (s && s.id === m.id ? { ...s, read_at: res.message.read_at } : s));
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir esta mensagem agora?")) return;
    setActionError(null);
    try {
      await api(`/api/messages/${id}`, { method: "DELETE" });
      if (selected?.id === id) setSelected(null);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  if (loading && !data) return <Spinner />;
  if (!data) {
    return (
      <div className="space-y-4">
        <Alert>{error ?? "Caixa não encontrada."}</Alert>
        <Link href="/caixas" className="text-sm text-indigo-600 hover:underline">← Voltar</Link>
      </div>
    );
  }

  const address = `${data.mailbox.local_part}@${data.mailbox.domain}`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/caixas" className="text-sm text-slate-500 hover:underline">← Caixas</Link>
          <h1 className="mt-1 break-all font-mono text-xl font-semibold">{address}</h1>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton value={address} label="Copiar endereço" />
          <Button small variant="secondary" onClick={() => void refresh()}>Atualizar</Button>
        </div>
      </div>

      {data.mailbox.status !== "active" && <Alert kind="warning">Esta caixa está desativada e não recebe novas mensagens.</Alert>}
      {error && <Alert kind="warning">Falha na atualização automática: {error}. Os dados podem estar desatualizados.</Alert>}
      {actionError && <Alert>{actionError}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label="Mensagens">
          {messages.length === 0 ? (
            <EmptyState title="Nenhuma mensagem">
              Envie um e-mail para <span className="font-mono">{address}</span>. A lista atualiza automaticamente.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => void open(m.id)}
                    className={`w-full rounded-xl border p-3 text-left transition hover:border-indigo-300 dark:hover:border-indigo-700 ${selected?.id === m.id ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${m.read_at ? "text-slate-600 dark:text-slate-300" : "font-semibold"}`}>
                        {m.from_name || m.from_address || "(remetente desconhecido)"}
                      </span>
                      <Countdown expiresAt={m.expires_at} now={now} />
                    </div>
                    <p className={`truncate text-sm ${m.read_at ? "text-slate-500" : "text-slate-900 dark:text-white"}`}>{m.subject || "(sem assunto)"}</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">{formatTime(m.received_at)}</span>
                      {m.code_status === "found" && m.code && (
                        <span className="rounded bg-indigo-100 px-1.5 font-mono text-xs text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">{m.code}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Mensagem selecionada">
          {detailError && <Alert kind="info">{detailError}</Alert>}
          {selected ? (
            <Card className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold">{selected.subject || "(sem assunto)"}</h2>
                  <p className="break-all text-sm text-slate-600 dark:text-slate-300">
                    {selected.from_name ? `${selected.from_name} ` : ""}&lt;{selected.from_address ?? "desconhecido"}&gt;
                  </p>
                  <p className="text-xs text-slate-500">
                    Recebida às {formatTime(selected.received_at)}
                    {selected.recipient_tag ? ` · via +${selected.recipient_tag}` : ""}
                  </p>
                </div>
                <Countdown expiresAt={selected.expires_at} now={now} />
              </div>
              <VerificationBadge verification={selected.sender_verification} service={selected.sender_service} />
              <CodePanel status={selected.code_status} code={selected.code} candidates={selected.code_candidates} receivedAt={selected.received_at} />
              {selected.sender_verification !== "verificado" && selected.code_status === "found" && (
                <p className="text-xs text-slate-500">
                  O código foi encontrado no texto, mas a autenticidade do remetente não pôde ser confirmada.
                </p>
              )}
              {/* Sempre texto simples: nada de HTML, scripts, formulários ou imagens remotas. */}
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 font-sans text-sm text-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {selected.text_body || "(mensagem sem texto)"}
              </pre>
              <div className="flex gap-2">
                <Button small variant="secondary" onClick={() => void toggleRead(selected)}>
                  {selected.read_at ? "Marcar como não lida" : "Marcar como lida"}
                </Button>
                <Button small variant="danger" onClick={() => void remove(selected.id)}>Excluir</Button>
              </div>
            </Card>
          ) : (
            !detailError && <EmptyState title="Selecione uma mensagem" />
          )}
        </section>
      </div>
    </div>
  );
}
