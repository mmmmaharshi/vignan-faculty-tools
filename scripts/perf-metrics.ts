/** Transfer cost of a built app, measured from dist/ — no server needed.
 *  Run `bun run build` first, then `bun scripts/perf-metrics.ts`. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const groupOf = (name: string): string =>
  name.endsWith(".js")
    ? "js"
    : name.endsWith(".css")
      ? "css"
      : name.endsWith(".woff2") || name.endsWith(".woff")
        ? "font"
        : name.endsWith(".png") || name.endsWith(".svg")
          ? "image"
          : "other";

function files(dir: string): Array<string> {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const groups = new Map<string, { raw: number; gzip: number; count: number }>();
/** Already-compressed formats travel as-is: gzipping a woff2 or png only
 *  spends CPU to grow the reply, and the server answers them raw too. */
const wireBytes = (file: string, bytes: Buffer): number =>
  file.endsWith(".png") || file.endsWith(".woff2") || file.endsWith(".woff")
    ? bytes.length
    : gzipSync(bytes, { level: 9 }).length;
for (const file of files("dist")) {
  const bytes = readFileSync(file);
  const gz = wireBytes(file, bytes);
  const g = groupOf(file);
  const row = groups.get(g) ?? { raw: 0, gzip: 0, count: 0 };
  row.raw += bytes.length;
  row.gzip += gz;
  row.count += 1;
  groups.set(g, row);
}
const order = ["js", "css", "font", "image", "other"];
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
out("group   files   raw bytes   gzip bytes");
for (const g of order) {
  const r = groups.get(g);
  if (r) {
    out(
      `${g.padEnd(7)} ${String(r.count).padStart(5)} ${String(r.raw).padStart(11)} ${String(r.gzip).padStart(12)}`
    );
  }
}
const total = [...groups.values()].reduce(
  (a, r) => ({ raw: a.raw + r.raw, gzip: a.gzip + r.gzip }),
  { raw: 0, gzip: 0 }
);
out(
  `total          ${String([...groups.values()].reduce((n, r) => n + r.count, 0)).padStart(5)} ${String(total.raw).padStart(11)} ${String(total.gzip).padStart(12)}`
);
/** First paint, not the whole app: the entry script, its preloads and the
 *  stylesheet index.html names, plus the document itself. Lazy screens load
 *  later, so the total above overstates what the sign-in form fetches. */
const html = readFileSync(path.join("dist", "index.html"), "utf8");
const initialRefs = new Set<string>(["index.html"]);
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
  const ref = match[1];
  if (ref) {
    initialRefs.add(ref.slice(1));
  }
}
let initial = { raw: 0, gzip: 0 };
for (const ref of initialRefs) {
  const bytes = readFileSync(path.join("dist", ref));
  initial = {
    raw: initial.raw + bytes.length,
    gzip: initial.gzip + wireBytes(ref, bytes),
  };
}
out(
  `initial        ${String(initialRefs.size).padStart(5)} ${String(initial.raw).padStart(11)} ${String(initial.gzip).padStart(12)}`
);
