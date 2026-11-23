import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PLACEHOLDER = "__SHELL_VERSION__";

/** The worker is copied verbatim from public/, so Vite never transforms it.
 *  Stamping the built document's hash into its cache name means a new shell
 *  installs a new worker and a new cache; activate removes the old one. */
export function stampShellVersion(dist: string): void {
  const html = readFileSync(path.join(dist, "index.html"));
  const version = createHash("sha256").update(html).digest("hex").slice(0, 10);
  const workerPath = path.join(dist, "sw.js");
  const worker = readFileSync(workerPath, "utf8");
  if (!worker.includes(PLACEHOLDER)) {
    throw new Error("sw.js is missing its shell version placeholder");
  }
  writeFileSync(workerPath, worker.replaceAll(PLACEHOLDER, version));
}
