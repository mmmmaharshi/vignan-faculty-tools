import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

/** What compression pays for: code and documents. PNG and WOFF2 are already
 *  compressed — gzipping them only spends CPU to grow the reply. */
const COMPRESSIBLE = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".svg",
  ".txt",
  ".webmanifest",
]);
/** Below this many raw bytes the framing outweighs the saving. */
const MIN_BYTES = 1024;
/** `/assets/*` names carry a content hash, so a compressed copy held in memory
 *  can never go stale beside its source. */
const cache = new Map<string, Uint8Array<ArrayBuffer>>();

/** Whether an `Accept-Encoding` header value names gzip. */
export function acceptsGzip(header: string | null): boolean {
  return (header ?? "")
    .split(",")
    .some((part) => (part.split(";")[0] ?? "").trim().toLowerCase() === "gzip");
}

/** The gzipped reply for one asset, or null where compression does not apply:
 *  gzip unaccepted, an already-compressed format, a tiny file, or a reply that
 *  would not shrink. `headers` already carry this asset's own answer. */
export async function compressedAsset(
  resolved: string,
  reqPath: string,
  acceptEncoding: string | null,
  headers: Record<string, string>
): Promise<Response | null> {
  const compressible = COMPRESSIBLE.has(
    reqPath.slice(reqPath.lastIndexOf("."))
  );
  if (!acceptsGzip(acceptEncoding) || !compressible) {
    return null;
  }
  const answer = (gz: Blob): Response =>
    new Response(gz, {
      headers: {
        ...headers,
        "content-encoding": "gzip",
        vary: "Accept-Encoding",
      },
    });
  const hit = cache.get(resolved);
  if (hit) {
    return answer(new Blob([hit]));
  }
  const raw = await readFile(resolved);
  if (raw.byteLength < MIN_BYTES) {
    return null;
  }
  const gz = Uint8Array.from(gzipSync(Buffer.from(raw), { level: 9 }));
  if (gz.length >= raw.byteLength) {
    return null;
  }
  cache.set(resolved, gz);
  return answer(new Blob([gz]));
}
