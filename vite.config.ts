import type { IncomingMessage, ServerResponse } from "node:http";

import react from "@vitejs/plugin-react";
import oxfmt from "ultracite/oxfmt";
import core from "ultracite/oxlint/core";
import reactPreset from "ultracite/oxlint/react";
import type { Plugin } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";

import { createApi } from "./server/api";

/** The dev server's API; `createApi`'s default reaches the real ECAP. */
const api = createApi();
async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}
async function serveApi(req: IncomingMessage, res: ServerResponse) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const body = await readBody(req);
  const request = new Request(
    new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`),
    {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      duplex: "half",
    } as RequestInit
  );
  const response = await api.handleApi(request);
  res.statusCode = response.status;
  for (const [key, value] of response.headers.entries())
    res.setHeader(key, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
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
    if (!res.headersSent) res.statusCode = 500;
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
        if (!req.url?.startsWith("/api/")) return next();
        void handleApiRequest(req, res, server);
      });
    },
  };
}

const SERVER_SIDE = ["server/**", "shared/**"];
const OFF: Record<string, "off"> = {
  curly: "off",
  "sort-keys": "off",
  "no-eq-null": "off",
  "react/todo": "off",
  "require-unicode-regexp": "off",
  complexity: "off",
  "no-await-in-loop": "off",
  "no-loop-func": "off",
  "func-style": "off",
  "no-inline-comments": "off",
  "no-plusplus": "off",
  "typescript/consistent-type-definitions": "off",
  "unicorn/no-useless-undefined": "off",
  "unicorn/prefer-dom-node-text-content": "off",
  "unicorn/filename-case": "off",
};
const rules = { ...core.rules, ...reactPreset.rules };
for (const rule of Object.keys(OFF)) {
  if (rule in rules) rules[rule] = OFF[rule];
}
rules.eqeqeq = ["error", "always", { null: "ignore" }];
// Not this project's source: prose, and the vendored skill files under `.agents/`.
const NOT_SOURCE = ["**/*.md", ".agents/**"];

export default defineConfig({
  staged: {
    "**/*": "vp check --fix",
  },
  fmt: {
    ...oxfmt,
    ignorePatterns: [...(oxfmt.ignorePatterns ?? []), ...NOT_SOURCE],
  },
  lint: {
    env: core.env,
    plugins: [...(core.plugins ?? []), ...(reactPreset.plugins ?? [])],
    ignorePatterns: [...(core.ignorePatterns ?? []), ...NOT_SOURCE],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { ...rules, "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: false, typeCheck: false },
    overrides: [
      ...(core.overrides ?? []),
      { files: SERVER_SIDE, env: { browser: false, node: true } },
    ],
  },
  root: "web",
  base: "/",
  plugins: lazyPlugins(() => [react(), apiPlugin()]),
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
