import { describe, expect, it } from "vitest";
import { dbErrorCode, errorMessage } from "./errors";
import { formatRemaining, serverOffset } from "./hooks";
import { safeNextPath } from "./redirect";

describe("redirecionamento seguro", () => {
  it("aceita apenas caminhos internos", () => {
    expect(safeNextPath("/caixas/abc")).toBe("/caixas/abc");
    expect(safeNextPath("//evil.example")).toBe("/caixas");
    expect(safeNextPath("/\\evil.example")).toBe("/caixas");
    expect(safeNextPath("https://evil.example")).toBe("/caixas");
    expect(safeNextPath("/x?u=https://evil")).toBe("/caixas");
    expect(safeNextPath("javascript:alert(1)")).toBe("/caixas");
    expect(safeNextPath(undefined)).toBe("/caixas");
  });
});

describe("contagem regressiva", () => {
  it("formata e indica expiração", () => {
    expect(formatRemaining(3_600_000)).toBe("60:00");
    expect(formatRemaining(61_000)).toBe("1:01");
    expect(formatRemaining(0)).toBe("expirada");
    expect(formatRemaining(-5)).toBe("expirada");
  });

  it("corrige diferença de relógio com o servidor", () => {
    const ahead = new Date(Date.now() + 120_000).toISOString();
    expect(serverOffset(ahead)).toBeGreaterThan(110_000);
    expect(serverOffset(undefined)).toBe(0);
    expect(serverOffset("lixo")).toBe(0);
  });
});

describe("mensagens de erro", () => {
  it("mapeia erros do banco sem vazar detalhes internos", () => {
    expect(dbErrorCode('P0001: limite_caixas')).toBe("limite_caixas");
    expect(dbErrorCode("relation secret_table does not exist")).toBe("erro_interno");
    expect(errorMessage("erro_interno")).not.toMatch(/relation|sql/i);
  });
});
