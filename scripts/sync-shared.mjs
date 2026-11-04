// Copia packages/core/src para supabase/functions/_shared/core, pois o
// bundler das Edge Functions só inclui arquivos dentro de supabase/functions.
// Um teste garante que as cópias não divergem (tests/shared-sync.test.ts).
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const src = join(root, "packages", "core", "src");
const dest = join(root, "supabase", "functions", "_shared", "core");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
  copyFileSync(join(src, file), join(dest, file));
}
console.log(`core sincronizado em ${dest}`);
