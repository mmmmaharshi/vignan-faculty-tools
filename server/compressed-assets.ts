import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** What compression pays for: code and documents. PNG and WOFF2 are already
 *  compressed — touching them only spends CPU to grow the reply. */
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
 *  can never go stale beside its source. Brotli fills in at boot; gzip fills
 *  in on demand, so the first request never waits on the slower pass. */
const cache = new Map<
  string,
  { gz?: Uint8Array<ArrayBuffer>; br?: Uint8Array<ArrayBuffer> }
>();

/** Whether an `Accept-Encoding` header value names `token`, excluding an
 *  explicit refusal (`br;q=0` is a client saying no). */
export function acceptsEncoding(
  header: string | null,
  token: "br" | "gzip"
): boolean {
  return (header ?? "").split(",").some((part) => {
    const [name, ...params] = part.split(";");
    if ((name ?? "").trim().toLowerCase() !== token) {
      return false;
    }
    return !params.some(
      (p) => p.trim().toLowerCase().replaceAll(" ", "") === "q=0"
    );
  });
}

/** Whether an `Accept-Encoding` header value names gzip. */
export function acceptsGzip(header: string | null): boolean {
  return acceptsEncoding(header, "gzip");
}

/** Compresses what pays and keeps it: the boot-time pass, so requests never
 *  wait on Brotli's slowest quality. A file that would not shrink, or a
 *  directory that will not read, simply stays out of the cache. */
export async function warmCompressedAssets(dir: string): Promise<void> {
  let names: Array<string>;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => COMPRESSIBLE.has(name.slice(name.lastIndexOf("."))))
      .map(async (name) => {
        const resolved = path.join(dir, name);
        let raw: Buffer;
        try {
          raw = await readFile(resolved);
        } catch {
          return;
        }
        if (raw.byteLength < MIN_BYTES) {
          return;
        }
        const gz = Uint8Array.from(gzipSync(raw, { level: 9 }));
        const br = Uint8Array.from(
          brotliCompressSync(raw, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: 11,
            },
          })
        );
        const kept = cache.get(resolved) ?? {};
        if (gz.length < raw.byteLength) {
          kept.gz = gz;
        }
        if (br.length < raw.byteLength) {
          kept.br = br;
        }
        cache.set(resolved, kept);
      })
  );
}

/** The compressed reply for one asset, or null where compression does not
 *  apply: neither encoding accepted, an already-compressed format, a tiny
 *  file, or a reply that would not shrink. Brotli wins where the client names
 *  it; `headers` already carry this asset's own answer. */
export async function compressedAsset(
  resolved: string,
  reqPath: string,
  acceptEncoding: string | null,
  headers: Record<string, string>
): Promise<Response | null> {
  const compressible = COMPRESSIBLE.has(
    reqPath.slice(reqPath.lastIndexOf("."))
  );
  const br = acceptsEncoding(acceptEncoding, "br");
  const gzip = acceptsGzip(acceptEncoding);
  if ((!br && !gzip) || !compressible) {
    return null;
  }
  const answer = (body: Blob, encoding: string): Response =>
    new Response(body, {
      headers: {
        ...headers,
        "content-encoding": encoding,
        vary: "Accept-Encoding",
      },
    });
  const hit = cache.get(resolved);
  if (br && hit?.br) {
    return answer(new Blob([hit.br]), "br");
  }
  if (gzip && hit?.gz) {
    return answer(new Blob([hit.gz]), "gzip");
  }
  const raw = await readFile(resolved);
  if (raw.byteLength < MIN_BYTES) {
    return null;
  }
  const gz = Uint8Array.from(gzipSync(Buffer.from(raw), { level: 9 }));
  if (gz.length >= raw.byteLength) {
    return null;
  }
  cache.set(resolved, { ...hit, gz });
  // Brotli was refused or the boot pass has not reached this file: gzip is
  // the answer either way, since this path never waits on quality 11.
  if (!gzip) {
    return null;
  }
  return answer(new Blob([gz]), "gzip");
}
