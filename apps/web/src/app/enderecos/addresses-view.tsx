"use client";

import { useRef, useState } from "react";
import { LOCAL_PART_ERROR_MESSAGES, parseNameList, type NameEntry } from "@inboxnexo/core";
import { Alert, Button, Card, EmptyState } from "@/components/ui";
import { api } from "@/lib/client";

type ServerStatus = "disponivel" | "sua_caixa" | "em_uso" | "reservado" | "invalido";

interface CheckResponse {
  results: { local_part: string; status: ServerStatus }[];
  mailboxCount: number;
  maxMailboxes: number;
}

const STATUS_LABEL: Record<ServerStatus, { text: string; tone: string }> = {
  disponivel: { text: "Disponível", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
  sua_caixa: { text: "Sua caixa", tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200" },
  em_uso: { text: "Indisponível", tone: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  reservado: { text: "Reservado", tone: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-200" },
  invalido: { text: "Inválido", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200" },
};

const MAX_TXT_BYTES = 100 * 1024;

function isUsable(e: NameEntry): boolean {
  return e.error === null && e.duplicateOf === null;
}

export function AddressesView({ domain, initialCount, maxMailboxes }: { domain: string; initialCount: number; maxMailboxes: number }) {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<NameEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(initialCount);
  const [max, setMax] = useState(maxMailboxes);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const limitReached = count >= max;
  const address = (lp: string) => `${lp}@${domain}`;

  async function refreshStatus(list: NameEntry[]) {
    const unique = [...new Set(list.filter(isUsable).map((e) => e.localPart))];
    if (unique.length === 0) {
      setStatuses({});
      return;
    }
    setChecking(true);
    try {
      const res = await api<CheckResponse>("/api/addresses/check", { method: "POST", body: { localParts: unique } });
      setStatuses(Object.fromEntries(res.results.map((r) => [r.local_part, r.status])));
      setCount(res.mailboxCount);
      setMax(res.maxMailboxes);
    } catch (err) {
      setNotice({ kind: "error", text: `Não foi possível verificar a disponibilidade: ${(err as Error).message}` });
    } finally {
      setChecking(false);
    }
  }

  async function analyze(source = text) {
    setNotice(null);
    const parsed = parseNameList(source);
    setEntries(parsed);
    setSelected(new Set());
    setStatuses({});
    if (parsed.length === 0) {
      setNotice({ kind: "info", text: "Nenhum nome encontrado. Coloque um nome por linha." });
      return;
    }
    await refreshStatus(parsed);
  }

  function importTxt(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_TXT_BYTES) {
      setNotice({ kind: "error", text: "Arquivo grande demais (máximo 100 KB)." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? "");
      setText(content);
      void analyze(content);
    };
    reader.onerror = () => setNotice({ kind: "error", text: "Não foi possível ler o arquivo." });
    reader.readAsText(file, "utf-8");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function copyAddresses() {
    const pool = entries.filter(isUsable).map((e) => e.localPart);
    const chosen = selected.size > 0 ? pool.filter((lp) => selected.has(lp)) : pool;
    if (chosen.length === 0) return;
    try {
      await navigator.clipboard.writeText(chosen.map(address).join("\n"));
      setNotice({ kind: "success", text: `${chosen.length} endereço(s) copiado(s).` });
    } catch {
      setNotice({ kind: "error", text: "Não foi possível copiar para a área de transferência." });
    }
  }

  async function createMailbox(lp: string) {
    if (!confirm(`Criar a caixa ${address(lp)}?\n\nEndereços excluídos não podem ser reutilizados depois.`)) return;
    setCreating(lp);
    setNotice(null);
    try {
      await api("/api/mailboxes", { method: "POST", body: { localPart: lp } });
      setStatuses((s) => ({ ...s, [lp]: "sua_caixa" }));
      setCount((c) => c + 1);
      setNotice({ kind: "success", text: `Caixa ${address(lp)} criada. Ela já aparece em Minhas caixas.` });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
      await refreshStatus(entries);
    } finally {
      setCreating(null);
    }
  }

  function toggle(lp: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lp)) next.delete(lp);
      else next.add(lp);
      return next;
    });
  }

  const usable = entries.filter(isUsable);
  const allSelected = usable.length > 0 && usable.every((e) => selected.has(e.localPart));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Endereços</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cole nomes (um por linha). Usamos só o primeiro nome, sem acentos, para sugerir endereços @{domain}. A prévia não cria caixas.
          </p>
        </div>
        <span className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${limitReached ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200" : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"}`}>
          CAIXAS ATIVAS: {count}/{max}
        </span>
      </div>

      {limitReached && (
        <Alert kind="warning">
          Você atingiu o limite de {max} caixas da sua conta (caixas desativadas também contam). Para criar outra, exclua uma caixa em Minhas caixas — o endereço excluído não poderá ser reutilizado.
        </Alert>
      )}
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="space-y-3">
          <label htmlFor="names" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Nomes</label>
          <textarea
            id="names"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder={"Antonella Virelli\nLavínia Morelli\nRafaela Veloso"}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void analyze()} disabled={checking || !text.trim()}>
              {checking ? "Analisando…" : "ANALISAR NOMES"}
            </Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>IMPORTAR TXT</Button>
            <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => importTxt(e.target.files?.[0])} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Até 200 nomes por análise. Arquivo TXT: um nome por linha, até 100 KB.</p>
        </Card>

        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Prévia</h2>
            <div className="flex flex-wrap gap-2">
              <Button small variant="secondary" onClick={() => void copyAddresses()} disabled={usable.length === 0}>
                COPIAR ENDEREÇOS{selected.size > 0 ? ` (${selected.size})` : ""}
              </Button>
              <Button small variant="secondary" onClick={() => void refreshStatus(entries)} disabled={checking || usable.length === 0}>
                ATUALIZAR STATUS
              </Button>
            </div>
          </div>

          {entries.length === 0 ? (
            <EmptyState title="Nenhuma prévia">Cole os nomes e clique em ANALISAR NOMES.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th className="p-2">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(usable.map((e) => e.localPart)))}
                      />
                    </th>
                    <th className="p-2">Nome original</th>
                    <th className="p-2">Identificador</th>
                    <th className="p-2">Endereço completo</th>
                    <th className="p-2">Disponibilidade local</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const ok = isUsable(e);
                    const status = ok ? statuses[e.localPart] : undefined;
                    const canCreate = ok && status === "disponivel" && !limitReached && creating === null;
                    return (
                      <tr key={e.line} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-2">
                          {ok && <input type="checkbox" aria-label={`Selecionar ${e.localPart}`} checked={selected.has(e.localPart)} onChange={() => toggle(e.localPart)} />}
                        </td>
                        <td className="p-2">{e.original}</td>
                        <td className="p-2 font-mono text-xs">{e.localPart || "—"}</td>
                        <td className="p-2 font-mono text-xs">{e.error === null ? address(e.localPart) : "—"}</td>
                        <td className="p-2 text-xs">
                          {e.error !== null ? (
                            <span className="text-rose-600 dark:text-rose-400">{LOCAL_PART_ERROR_MESSAGES[e.error]}</span>
                          ) : e.duplicateOf !== null ? (
                            <span className="text-amber-700 dark:text-amber-300">Duplicado (linha {e.duplicateOf})</span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-300">Válido</span>
                          )}
                        </td>
                        <td className="p-2">
                          {status ? (
                            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_LABEL[status].tone}`}>{STATUS_LABEL[status].text}</span>
                          ) : ok ? (
                            <span className="text-xs text-slate-500">{checking ? "Verificando…" : "Não verificado"}</span>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                        <td className="p-2">
                          {ok && status === "disponivel" && (
                            <Button small onClick={() => void createMailbox(e.localPart)} disabled={!canCreate}
                              title={limitReached ? "Limite de caixas atingido" : undefined}>
                              {creating === e.localPart ? "Criando…" : "CRIAR CAIXA"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cada caixa é criada individualmente, após confirmação, pelo mesmo cadastro de Minhas caixas. &quot;Indisponível&quot; inclui endereços de outros usuários e endereços excluídos, que nunca são reutilizados.
          </p>
        </Card>
      </div>
    </div>
  );
}
