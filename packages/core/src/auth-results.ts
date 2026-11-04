/**
 * Verificação do remetente a partir do cabeçalho Authentication-Results
 * (RFC 8601).
 *
 * Regras de confiança:
 * - Apenas o PRIMEIRO cabeçalho (o mais recente, adicionado pelo último MTA)
 *   é considerado, e somente se o authserv-id estiver na lista
 *   TRUSTED_AUTHSERV_IDS configurada pelo operador.
 * - Lista vazia (padrão) => nada é confiável => "nao_verificado".
 *   O operador só deve preencher a lista após inspecionar mensagens reais
 *   recebidas pelo Email Routing e confirmar qual authserv-id o Cloudflare
 *   adiciona (ver docs/DIAGNOSTICO.md). Um remetente pode inserir cabeçalhos
 *   falsos; por isso nunca confiamos em qualquer cabeçalho arbitrário.
 * - "verificado" exige dmarc=pass com header.from alinhado ao domínio do
 *   From visível E esse domínio pertencer à lista de domínios reconhecidos
 *   do serviço (ex.: Instagram).
 */

export type SenderVerification = "verificado" | "falhou" | "nao_verificado";

export interface ParsedAuthResults {
  authservId: string;
  spf: string | null;
  spfDomain: string | null;
  dkim: { result: string; domain: string | null }[];
  dmarc: string | null;
  dmarcFrom: string | null;
}

export interface ServiceDomains {
  id: string;
  label: string;
  domains: string[];
}

export function parseAuthenticationResults(value: string): ParsedAuthResults | null {
  const cleaned = value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(";").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const authservId = parts[0]!.split(" ")[0]!.toLowerCase();
  if (!authservId) return null;
  const out: ParsedAuthResults = { authservId, spf: null, spfDomain: null, dkim: [], dmarc: null, dmarcFrom: null };
  for (const part of parts.slice(1)) {
    const method = part.match(/^(spf|dkim|dmarc)\s*=\s*([a-z]+)/i);
    if (!method) continue;
    const name = method[1]!.toLowerCase();
    const result = method[2]!.toLowerCase();
    const prop = (key: string) => part.match(new RegExp(`${key}\\s*=\\s*"?([^\\s";]+)`, "i"))?.[1]?.toLowerCase() ?? null;
    if (name === "spf") {
      out.spf = result;
      const mf = prop("smtp\\.mailfrom");
      out.spfDomain = mf ? mf.split("@").pop() ?? null : null;
    } else if (name === "dkim") {
      out.dkim.push({ result, domain: prop("header\\.d") ?? prop("header\\.i")?.split("@").pop() ?? null });
    } else if (name === "dmarc") {
      out.dmarc = result;
      out.dmarcFrom = prop("header\\.from");
    }
  }
  return out;
}

export function domainOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at === -1) return null;
  return address.slice(at + 1).trim().replace(/>$/, "").toLowerCase() || null;
}

export function domainMatches(domain: string, allowed: string): boolean {
  const d = domain.toLowerCase();
  const a = allowed.toLowerCase();
  return d === a || d.endsWith(`.${a}`);
}

export interface VerificationInput {
  /** Valores do cabeçalho Authentication-Results na ordem em que aparecem. */
  authResultsHeaders: string[];
  /** Endereço do cabeçalho From visível (já interpretado). */
  fromAddress: string | null;
  trustedAuthservIds: string[];
  services: ServiceDomains[];
}

export interface VerificationResult {
  verification: SenderVerification;
  serviceId: string | null;
  detail: string;
}

export function verifySender(input: VerificationInput): VerificationResult {
  const fromDomain = domainOf(input.fromAddress);
  const service = fromDomain
    ? input.services.find((s) => s.domains.some((d) => domainMatches(fromDomain, d))) ?? null
    : null;
  const trusted = input.trustedAuthservIds.map((t) => t.toLowerCase()).filter(Boolean);
  const top = input.authResultsHeaders[0];
  if (trusted.length === 0 || !top) {
    return { verification: "nao_verificado", serviceId: null, detail: "sem_resultado_confiavel" };
  }
  const parsed = parseAuthenticationResults(top);
  if (!parsed || !trusted.includes(parsed.authservId)) {
    return { verification: "nao_verificado", serviceId: null, detail: "authserv_nao_confiavel" };
  }
  if (!fromDomain) return { verification: "falhou", serviceId: null, detail: "from_ausente" };
  if (parsed.dmarc === "fail") return { verification: "falhou", serviceId: null, detail: "dmarc_fail" };
  const dmarcAligned =
    parsed.dmarc === "pass" && parsed.dmarcFrom !== null && parsed.dmarcFrom === fromDomain;
  if (!dmarcAligned) return { verification: "nao_verificado", serviceId: null, detail: "dmarc_sem_alinhamento" };
  if (!service) return { verification: "nao_verificado", serviceId: null, detail: "dominio_nao_reconhecido" };
  return { verification: "verificado", serviceId: service.id, detail: "dmarc_pass_alinhado" };
}

/**
 * Domínios reconhecidos por padrão. Fonte: páginas de ajuda do Instagram
 * citadas por terceiros indicam @mail.instagram.com como domínio de envio
 * de e-mails de segurança. Confirme em https://help.instagram.com antes de
 * produção e ajuste RECOGNIZED_SENDER_DOMAINS no Worker.
 */
export const DEFAULT_SERVICES: ServiceDomains[] = [
  { id: "instagram", label: "Instagram", domains: ["mail.instagram.com"] },
];

/** Formato: "instagram:Instagram:mail.instagram.com,facebookmail.com;outro:Outro:dominio.com" */
export function parseServicesConfig(value: string | undefined): ServiceDomains[] {
  if (!value || !value.trim()) return DEFAULT_SERVICES;
  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, label, domains] = entry.split(":");
      return {
        id: (id ?? "").trim(),
        label: (label ?? id ?? "").trim(),
        domains: (domains ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
      };
    })
    .filter((s) => s.id && s.domains.length > 0);
}
