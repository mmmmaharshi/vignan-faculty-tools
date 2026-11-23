import type { IncomingMessage, ServerResponse } from "node:http";

import cloudflare from "@cloudflare/oxlint-config";
import react from "@vitejs/plugin-react";
import oxfmt from "ultracite/oxfmt";
import type { Plugin, ViteUserConfig } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";

import { stampShellVersion } from "./scripts/shell-version";
import { createApi } from "./server/api";
import { safeHost } from "./shared/api";

/** The dev server's API; `createApi`'s default reaches the real ECAP. */
const api = createApi();
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }
  const chunks: Array<Buffer> = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}
async function serveApi(req: IncomingMessage, res: ServerResponse) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    }
  }
  const body = await readBody(req);
  const request = new Request(
    new URL(
      req.url ?? "/",
      `http://${safeHost(req.headers.host, "localhost")}`
    ),
    {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      duplex: "half",
    } as RequestInit
  );
  const response = await api.handleApi(request);
  res.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    res.setHeader(key, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) {
    res.setHeader("set-cookie", cookies);
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  server: { config: { logger: { error: (msg: string) => void } } }
) {
  try {
    await serveApi(req, res);
  } catch (error) {
    server.config.logger.error(String(error));
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    res.end();
  }
}
/** Runs the API inside the dev server, so one process serves the app and `/api`. */
function apiPlugin(): Plugin {
  return {
    name: "ecap-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          return next();
        }
        void handleApiRequest(req, res, server);
      });
    },
  };
}

function shellVersionPlugin(): Plugin {
  return {
    name: "shell-version",
    apply: "build",
    closeBundle() {
      stampShellVersion("dist");
    },
  };
}

// Not this project's source: prose, and the vendored skill files under `.agents/`.
const NOT_SOURCE = ["**/*.md", ".agents/**"];
// The preset and Vite+ declare their own copies of oxlint's config types; their
// shapes agree at runtime, so one assertion bridges the duplicate declarations.
type LintPreset = NonNullable<ViteUserConfig["lint"]>;
const preset = cloudflare as LintPreset;

export default defineConfig({
  staged: {
    // Lint and format the staged files, then type-check every project: the
    // formatter does not read types, so a type error would otherwise reach a
    // commit the moment nobody ran the suite.
    "**/*": ["vp check --fix", "bun scripts/typecheck-staged.ts"],
  },
  fmt: {
    ...oxfmt,
    ignorePatterns: [...(oxfmt.ignorePatterns ?? []), ...NOT_SOURCE],
  },
  lint: {
    ...preset,
    ignorePatterns: [...(preset.ignorePatterns ?? []), ...NOT_SOURCE],
    jsPlugins: [
      ...(preset.jsPlugins ?? []),
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
    ],
    rules: {
      ...preset.rules,
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { ...preset.options, typeAware: false, typeCheck: false },
    overrides: [
      ...(preset.overrides ?? []),
      {
        files: ["server/**", "shared/**"],
        env: { browser: false, node: true },
      },
    ],
  },
  root: "web",
  base: "/",
  plugins: lazyPlugins(() => [react(), apiPlugin(), shellVersionPlugin()]),
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
