import { describe, expect, it } from "vitest";
import { firstNameToLocalPart, parseNameList } from "./names.ts";

describe("nomes para identificadores", () => {
  it("usa só o primeiro nome, remove acentos e converte para minúsculas", () => {
    expect(firstNameToLocalPart("Antonella Virelli")).toBe("antonella");
    expect(firstNameToLocalPart("  Lavínia   Morelli ")).toBe("lavinia");
    expect(firstNameToLocalPart("JOÃO")).toBe("joao");
    expect(firstNameToLocalPart("Çécília")).toBe("cecilia");
    expect(firstNameToLocalPart("Ana-Clara Souza")).toBe("ana-clara");
    expect(firstNameToLocalPart("O'Neil")).toBe("oneil");
  });

  it("processa a lista do exemplo", () => {
    const entries = parseNameList("Antonella Virelli\nLavínia Morelli\nRafaela Veloso\nBianca Savelli\nKiara Bellini\n");
    expect(entries.map((e) => e.localPart)).toEqual(["antonella", "lavinia", "rafaela", "bianca", "kiara"]);
    expect(entries.every((e) => e.error === null && e.duplicateOf === null)).toBe(true);
  });

  it("detecta duplicatas pelo identificador final", () => {
    const entries = parseNameList("Bianca Savelli\nbianca Souza\nBIÁNCA\nKiara");
    expect(entries.map((e) => e.duplicateOf)).toEqual([null, 1, 1, null]);
  });

  it("valida identificadores com a regra do cadastro", () => {
    const entries = parseNameList("Al\n😀\nMaximilianaaaaaaaaaaaaaaaaaaaaaaaaaaa Silva\nAdmin");
    expect(entries[0]!.error).toBe("curto");
    expect(entries[1]!.error).toBe("vazio");
    expect(entries[2]!.error).toBe("longo");
    // "admin" é sintaticamente válido; a reserva é verificada no servidor.
    expect(entries[3]!.error).toBeNull();
  });

  it("importa TXT com BOM, CRLF e linhas vazias, respeitando o limite", () => {
    const entries = parseNameList("﻿Rafaela Veloso\r\n\r\n  \r\nKiara Bellini\r\n");
    expect(entries.map((e) => [e.line, e.localPart])).toEqual([[1, "rafaela"], [4, "kiara"]]);
    const many = Array.from({ length: 250 }, (_, i) => `Nome${i}`).join("\n");
    expect(parseNameList(many)).toHaveLength(200);
  });
});
