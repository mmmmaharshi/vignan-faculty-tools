import { createApi } from "../api.js";

type NodeHeaders = Record<string, string | string[] | undefined>;
type FunctionRequest = {
  url?: string;
  method?: string;
  headers: NodeHeaders;
  body?: unknown;
};
type FunctionResponse = {
  status: (code: number) => FunctionResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: Uint8Array | string) => void;
};

const api = createApi();

/**
 * Every `/api/*` request on Vercel's Node runtime, rebuilt as a fetch
 * Request for the same `handleApi` the local server and the dev plugin
 * share. The session travels in the request itself (see ADR 0024), so this
 * function keeps nothing between invocations.
 */
export default async function handler(
  req: FunctionRequest,
  res: FunctionResponse
): Promise<void> {
  const host =
    (typeof req.headers.host === "string" && req.headers.host) || "localhost";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  // Vercel parses JSON bodies before the function sees them; handing
  // handleApi the re-serialised bytes is what it would read off the wire.
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined) {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  }
  const response = await api.handleApi(
    new Request(`https://${host}${req.url ?? "/api/"}`, {
      method: req.method,
      headers,
      body,
    })
  );
  res.status(response.status);
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "content-length") continue;
    res.setHeader(name, value);
  }
  res.send(new Uint8Array(await response.arrayBuffer()));
}
