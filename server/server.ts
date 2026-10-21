import type { ErrorReply } from "../shared/api.js";
import { createApi, json } from "./api.js";

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
    },
  });
}
const api = createApi();
const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        return indexHtml();
      }
      if (req.method === "GET" && path === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      if (req.method === "GET" && !path.startsWith("/api/")) {
        const asset = Bun.file(DIST + path);
        if (await asset.exists()) {
          return new Response(asset, {
            headers: {
              "content-type": asset.type || "application/octet-stream",
              "cache-control": path.startsWith("/assets/")
                ? "public, max-age=31536000, immutable"
                : "no-store, must-revalidate",
            },
          });
        }
        if (!path.includes(".")) {
          return indexHtml();
        }
      }
      if (path.startsWith("/api/")) {
        return api.handleApi(req);
      }
      return json({ error: "Not found" } satisfies ErrorReply, 404);
    } catch (error) {
      console.error("[error]", error);
      return json({ error: "Something went wrong." }, 500);
    }
  },
});
console.log(`\n  Vignan Faculty Tools`);
console.log(`  http://127.0.0.1:${server.port}\n`);
