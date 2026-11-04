/**
 * Converte HTML recebido em texto simples. Nunca produz HTML: o resultado é
 * exibido como texto pelo painel (React escapa o conteúdo). Scripts, estilos,
 * formulários e imagens são descartados; links viram apenas o texto visível.
 */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  agrave: "à", atilde: "ã", otilde: "õ", acirc: "â", ecirc: "ê", ocirc: "ô",
  ccedil: "ç", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  Atilde: "Ã", Otilde: "Õ", Ccedil: "Ç", copy: "©", reg: "®", hellip: "…",
  ndash: "–", mdash: "—", laquo: "«", raquo: "»",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      return String.fromCodePoint(code);
    }
    return ENTITIES[entity] ?? match;
  });
}

export function htmlToText(html: string, maxLength = 200_000): string {
  let s = html.slice(0, maxLength * 4);
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|head|title|noscript|template|svg|iframe|object|form)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(br|hr)\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|header|footer|blockquote)\s*>/gi, "\n");
  s = s.replace(/<(td|th)\b[^>]*>/gi, " ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/[<>]/g, "");
  s = decodeEntities(s);
  s = s.replace(/[​-‍﻿­͏]/g, "");
  s = s.replace(/[ \t\f\v ]+/g, " ");
  s = s.replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim().slice(0, maxLength);
}
