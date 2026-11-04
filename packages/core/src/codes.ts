/**
 * Extração de códigos de confirmação. O código é sempre tratado como texto
 * (zeros à esquerda preservados). "Código encontrado" NÃO implica remetente
 * autêntico: a verificação do remetente é feita em auth-results.ts.
 */

export type CodeStatus = "found" | "ambiguous" | "none";

export interface CodeResult {
  status: CodeStatus;
  code: string | null;
  candidates: string[];
  ruleId: string | null;
}

export interface CodeRule {
  id: string;
  /** Padrões de alta confiança; o grupo nomeado "code" contém o código. */
  strongPatterns: RegExp[];
  /** Palavras de contexto que tornam um número de N dígitos um candidato. */
  contextWords: RegExp;
  digits: number;
}

const CONTEXT_PT_EN =
  /(c[óo]digo|confirma[çc][ãa]o|confirmar|verifica[çc][ãa]o|verificar|seguran[çc]a|acesso|login|entrar|senha tempor[áa]ria|\bcode\b|confirm(ation)?|verif(y|ication)|security|one[- ]time|\botp\b|sign[- ]?in|log[- ]?in)/i;

export const DEFAULT_RULES: CodeRule[] = [
  {
    id: "instagram",
    digits: 6,
    contextWords: CONTEXT_PT_EN,
    strongPatterns: [
      /(?<![\d])(?<code>\d{6})(?![\d]) (?:is your Instagram code|é (?:o )?seu código do Instagram|es tu código de Instagram)/i,
      /Instagram[^\n]{0,60}?(?:code|código)[^\n\d]{0,30}(?<![\d])(?<code>\d{6})(?![\d])/i,
    ],
  },
  {
    id: "generic",
    digits: 6,
    contextWords: CONTEXT_PT_EN,
    strongPatterns: [],
  },
];

const CONTEXT_WINDOW = 80;

function isLikelyNotACode(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 3), start);
  const after = text.slice(end, end + 3);
  // Datas e horas (12/03/2024, 2024-03-12, 10:30), decimais e moedas.
  if (/[\/.:,-]\d?$/.test(before) && /\d/.test(before)) return true;
  if (/^[\/.:,-]\d/.test(after)) return true;
  // Telefones e números agrupados: "+55", "(11)", "11 987654 321".
  if (/[+(]\s?$/.test(before)) return true;
  if (/\d[\s-]$/.test(before) || /^[\s-]\d/.test(after)) return true;
  // Moeda e identificadores de pedido/protocolo.
  const prefix = text.slice(Math.max(0, start - 14), start).toLowerCase();
  if (/(r\$|us\$|\$|€|£)\s*$/.test(prefix)) return true;
  if (/(pedido|order|protocolo|ticket|n[ºo°]|#|cep|cpf|id)\s*[:#]?\s*$/.test(prefix)) return true;
  return false;
}

function contextHits(text: string, start: number, end: number, ctx: RegExp): boolean {
  const window = text.slice(Math.max(0, start - CONTEXT_WINDOW), Math.min(text.length, end + CONTEXT_WINDOW));
  return ctx.test(window);
}

function findContextual(text: string, rule: CodeRule, subjectHasContext: boolean): string[] {
  const re = new RegExp(`(?<![\\w-])\\d{${rule.digits}}(?![\\w-])`, "g");
  const found: string[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isLikelyNotACode(text, start, end)) continue;
    if (!contextHits(text, start, end, rule.contextWords) && !subjectHasContext) continue;
    found.push(m[0]);
  }
  return found;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractCode(
  subject: string,
  body: string,
  rules: CodeRule[] = DEFAULT_RULES,
): CodeResult {
  const subj = (subject ?? "").slice(0, 1000);
  const text = (body ?? "").slice(0, 100_000);

  for (const rule of rules) {
    const strong: string[] = [];
    for (const pattern of rule.strongPatterns) {
      for (const source of [subj, text]) {
        const m = source.match(pattern);
        if (m?.groups?.code) strong.push(m.groups.code);
      }
    }
    const uniq = unique(strong);
    if (uniq.length === 1) return { status: "found", code: uniq[0]!, candidates: uniq, ruleId: rule.id };
    if (uniq.length > 1) return { status: "ambiguous", code: null, candidates: uniq, ruleId: rule.id };
  }

  // Regras de serviço só reconhecem padrões fortes; a busca por contexto
  // usa as regras genéricas (sem padrões fortes).
  for (const rule of rules.filter((r) => r.strongPatterns.length === 0)) {
    const subjectHasContext = rule.contextWords.test(subj);
    const candidates = unique([
      ...findContextual(subj, rule, subjectHasContext),
      ...findContextual(text, rule, false),
    ]);
    if (candidates.length === 1) return { status: "found", code: candidates[0]!, candidates, ruleId: rule.id };
    if (candidates.length > 1) return { status: "ambiguous", code: null, candidates: candidates.slice(0, 5), ruleId: rule.id };
  }
  return { status: "none", code: null, candidates: [], ruleId: null };
}
