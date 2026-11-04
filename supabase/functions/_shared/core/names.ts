/**
 * Conversão de nomes (um por linha) em identificadores de caixa.
 * Usa somente o primeiro nome, remove acentos, converte para minúsculas e
 * valida com a mesma regra do cadastro (normalize.ts). Nada é criado aqui.
 */

import { validateLocalPart, type LocalPartError } from "./normalize.ts";

export interface NameEntry {
  line: number;
  original: string;
  localPart: string;
  error: LocalPartError | null;
  duplicateOf: number | null;
}

export const MAX_NAME_LINES = 200;

export function firstNameToLocalPart(input: string): string {
  const first = input.trim().split(/\s+/)[0] ?? "";
  return first
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
}

/** Interpreta a lista (texto colado ou TXT importado). Linhas vazias são ignoradas. */
export function parseNameList(text: string, maxLines = MAX_NAME_LINES): NameEntry[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const entries: NameEntry[] = [];
  const firstSeen = new Map<string, number>();
  lines.forEach((raw, index) => {
    const original = raw.trim();
    if (!original || entries.length >= maxLines) return;
    const localPart = firstNameToLocalPart(original);
    const error = validateLocalPart(localPart);
    const previous = error === null ? firstSeen.get(localPart) : undefined;
    if (error === null && previous === undefined) firstSeen.set(localPart, index + 1);
    entries.push({ line: index + 1, original, localPart, error, duplicateOf: previous ?? null });
  });
  return entries;
}
