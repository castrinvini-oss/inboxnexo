/**
 * Regra de normalização de endereços (aplicada no cadastro E no recebimento).
 *
 * 1. Remove espaços nas extremidades e converte para minúsculas (ASCII).
 * 2. O domínio deve ser EXATAMENTE o domínio configurado (sem subdomínios).
 * 3. Subendereço: tudo a partir do primeiro "+" é descartado SOMENTE para
 *    roteamento ("loja+promo" entrega na caixa "loja"). O "+" nunca é aceito
 *    em identificadores de caixa, portanto não há colisão.
 * 4. Pontos, hífens e sublinhados são preservados: "a.b" e "ab" são caixas
 *    diferentes. Nada é removido além do sufixo "+tag".
 * 5. Somente ASCII: [a-z0-9], ".", "_" e "-"; 3 a 32 caracteres; começa e
 *    termina com letra ou número; sem pontos consecutivos.
 */

export const LOCAL_PART_MIN = 3;
export const LOCAL_PART_MAX = 32;
const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export type LocalPartError =
  | "vazio"
  | "curto"
  | "longo"
  | "caracteres_invalidos"
  | "pontos_consecutivos";

export function validateLocalPart(input: string): LocalPartError | null {
  const value = input.trim().toLowerCase();
  if (value.length === 0) return "vazio";
  if (value.length < LOCAL_PART_MIN) return "curto";
  if (value.length > LOCAL_PART_MAX) return "longo";
  if (!LOCAL_PART_RE.test(value)) return "caracteres_invalidos";
  if (value.includes("..")) return "pontos_consecutivos";
  return null;
}

export function normalizeLocalPart(input: string): string {
  return input.trim().toLowerCase();
}

export const LOCAL_PART_ERROR_MESSAGES: Record<LocalPartError, string> = {
  vazio: "Informe um identificador.",
  curto: `Use pelo menos ${LOCAL_PART_MIN} caracteres.`,
  longo: `Use no máximo ${LOCAL_PART_MAX} caracteres.`,
  caracteres_invalidos:
    "Use apenas letras minúsculas, números, ponto, hífen ou sublinhado, começando e terminando com letra ou número.",
  pontos_consecutivos: "Não use pontos consecutivos.",
};

export type RecipientResult =
  | { ok: true; localPart: string; tag: string | null; address: string }
  | { ok: false; reason: "formato_invalido" | "dominio_incorreto" | "identificador_invalido" };

/** Interpreta o destinatário SMTP (envelope RCPT TO) recebido pelo Worker. */
export function parseRecipient(rcptTo: string, mailDomain: string): RecipientResult {
  const raw = rcptTo.trim().replace(/^<|>$/g, "").toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at !== raw.indexOf("@")) return { ok: false, reason: "formato_invalido" };
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (domain !== mailDomain.toLowerCase()) return { ok: false, reason: "dominio_incorreto" };
  const plus = local.indexOf("+");
  const base = plus === -1 ? local : local.slice(0, plus);
  const tag = plus === -1 ? null : local.slice(plus + 1);
  if (validateLocalPart(base) !== null) return { ok: false, reason: "identificador_invalido" };
  return { ok: true, localPart: base, tag: tag || null, address: `${base}@${domain}` };
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Gera identificador aleatório (sem caracteres ambíguos) usando Web Crypto. */
export function randomLocalPart(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
