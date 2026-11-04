import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const src = join(root, "packages", "core", "src");
const dest = join(root, "supabase", "functions", "_shared", "core");

describe("cópia do core para as Edge Functions", () => {
  it("está sincronizada (rode npm run sync:shared)", () => {
    const files = readdirSync(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      expect(readFileSync(join(dest, file), "utf8"), file).toBe(readFileSync(join(src, file), "utf8"));
    }
  });
});
