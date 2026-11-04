"use client";

import { useState } from "react";
import { CodePanel, Countdown } from "@/components/message-parts";
import { Alert, Button, Card } from "@/components/ui";
import { api } from "@/lib/client";
import { formatTime, serverOffset, useNow } from "@/lib/hooks";

interface SupportMessage {
  id: string;
  from_address: string | null;
  subject: string;
  text_body: string;
  code: string | null;
  code_status: string;
  received_at: string;
  expires_at: string;
}

/** Leitura de suporte: só funciona com autorização do proprietário e é auditada. */
export function AdminSupportReader({ mailbox, onClose }: { mailbox: { id: string; local_part: string; domain: string }; onClose: () => void }) {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const now = useNow() + offset;

  async function load() {
    setError(null);
    try {
      const res = await api<{ messages: SupportMessage[]; now: string }>(`/api/admin/mailboxes/${mailbox.id}/messages`);
      setOffset(serverOffset(res.now));
      setMessages(res.messages);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const visible = (messages ?? []).filter((m) => Date.parse(m.expires_at) > now);
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Suporte: {mailbox.local_part}@{mailbox.domain}</h2>
        <Button small variant="ghost" onClick={() => { setMessages(null); onClose(); }}>Fechar</Button>
      </div>
      <Alert kind="warning">
        Acesso a conteúdo de cliente. Exige autorização vigente do proprietário e fica registrado na auditoria.
      </Alert>
      {error && <Alert>{error}</Alert>}
      {messages === null ? (
        <Button onClick={() => void load()}>Ler mensagens (registrar acesso)</Button>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma mensagem dentro do prazo.</p>
      ) : (
        visible.map((m) => (
          <div key={m.id} className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{m.subject || "(sem assunto)"}</span>
              <Countdown expiresAt={m.expires_at} now={now} />
            </div>
            <p className="text-xs text-slate-500">{m.from_address} · {formatTime(m.received_at)}</p>
            <CodePanel status={m.code_status} code={m.code} candidates={[]} receivedAt={m.received_at} />
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{m.text_body}</pre>
          </div>
        ))
      )}
    </Card>
  );
}
