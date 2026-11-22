import type { ErrorReply } from "../shared/api.js";
import { createApi, json } from "./api.js";
import { SECURITY_HEADERS } from "./security-headers.js";
import { resolveWithin } from "./static-path.js";

const PORT = Number(process.env.PORT || 8787);
const ROOT = import.meta.dir;
const DIST = `${ROOT}/../dist`;
async function indexHtml(): Promise<Response> {
  const index = Bun.file(`${DIST}/index.html`);
  if (!(await index.exists())) {
    return new Response(
      "The front end has not been built yet.\n\nRun:  bun run build\n",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }
  return new Response(index, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, must-revalidate",
      ...SECURITY_HEADERS,
    },
  });
}
const api = createApi();
const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const reqPath = url.pathname;
    try {
      if (
        req.method === "GET" &&
        (reqPath === "/" || reqPath === "/index.html")
      ) {
        return indexHtml();
      }
      if (req.method === "GET" && reqPath === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      if (req.method === "GET" && !reqPath.startsWith("/api/")) {
        const resolved = resolveWithin(DIST, reqPath);
        if (!resolved) {
          return json({ error: "Not found" } satisfies ErrorReply, 404);
        }
        const asset = Bun.file(resolved);
        if (await asset.exists()) {
          // Bun's MIME table cannot be trusted for this one: Chrome wants the
          // manifest served as JSON, whatever the runtime guesses.
          const contentType = reqPath.endsWith(".webmanifest")
            ? "application/manifest+json"
            : asset.type || "application/octet-stream";
          return new Response(asset, {
            headers: {
              "content-type": contentType,
              "cache-control": reqPath.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "no-store, must-revalidate",
              ...SECURITY_HEADERS,
            },
          });
        }
        if (!reqPath.includes(".")) {
          return indexHtml();
        }
      }
      if (reqPath.startsWith("/api/")) {
        return api.handleApi(req);
      }
      return json({ error: "Not found" } satisfies ErrorReply, 404);
    } catch (error) {
      process.stderr.write("[error] " + String(error) + "\n");
      return json({ error: "Something went wrong." }, 500);
    }
  },
});
process.stdout.write("\n  Vignan Faculty Tools\n");
process.stdout.write(`  http://127.0.0.1:${server.port}\n\n`);
