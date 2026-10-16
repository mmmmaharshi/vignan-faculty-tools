import {
  absorbResponse,
  jqBody,
  nextHop,
  webMethodBody,
} from "./portal-conventions";
import type { CookieJar } from "./portal-conventions";
import { HttpError, looksLikeHtml, unquoteJs } from "./portal-replies";

export const BASE = "https://webprosindia.com";
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
export const HTTP_TIMEOUT_MS = 60_000;
export const LOGIN_PAGE = `${BASE}/vignanit/main.aspx`;
export const LOGIN_POST = `${BASE}/vignanit/Default.aspx?ReturnUrl=%2fvignanit%2fmain.aspx`;
const JQ = `${BASE}/vignanit/jqmethods.aspx`;
export const REGISTER_PAGE_URL = `${BASE}/vignanit/ACADEMICS/AcademicRegister.aspx?scrid=335`;
const REGISTER_PROXY = `${BASE}/vignanit/ajax/Academics_AcademicRegister,App_Web_academicregister.aspx.a2a1b31c.ashx`;
const CLASS_PAGE_URL = `${BASE}/vignanit/ACADEMICS/rptstudentsattendance.aspx?scrid=319`;
const CLASS_PROXY = `${BASE}/vignanit/ajax/Academics_rptstudentsattendance,App_Web_rptstudentsattendance.aspx.a2a1b31c.ashx`;
const PROFILE_PROXY = `${BASE}/vignanit/ajax/StudentProfile,App_Web_studentprofile.aspx.a2a1b31c.ashx`;
/** One generated-proxy remote: where it lives, which page it accepts, and its
 *  session marker. */
export type Remote = {
  proxy: string;
  referer: string;
  session: "no" | "r" | "rw";
};
export const REGISTER_REMOTE: Remote = {
  proxy: REGISTER_PROXY,
  referer: REGISTER_PAGE_URL,
  session: "no",
};
export const CLASS_REMOTE: Remote = {
  proxy: CLASS_PROXY,
  referer: CLASS_PAGE_URL,
  session: "no",
};
/** The one method here that wants the `rw` session marker rather than `no` —
 *  the wrong marker is a bare NullReferenceException with no parameter name
 *  in it. */
export const PROFILE_REMOTE: Remote = {
  proxy: PROFILE_PROXY,
  referer: REGISTER_PAGE_URL,
  session: "rw",
};
// oxlint-disable-next-line typescript/no-explicit-any -- the debt ADR 0002 records
type PortalPayload = any;
/**
 * One request through the jar, following redirects by hand: `Bun.fetch` does
 * not store `Set-Cookie`, so redirects followed automatically would drop the
 * auth cookie mid-flow and a successful sign-in would look like a failure.
 */
export async function portalRequest(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
  maxHops = 6
): Promise<Response> {
  const send = (target: string): Promise<Response> => {
    const cookie = jar.header();
    return fetch(target, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        ...(cookie ? { cookie } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  };
  let target = url;
  let res = await send(target);
  absorbResponse(jar, res);
  for (let hops = 0; hops < maxHops; hops++) {
    const next = nextHop(res, target, maxHops - hops);
    if (!next) break;
    target = next;
    res = await send(target);
    absorbResponse(jar, res);
  }
  return res;
}
/** The JQuery convention: a JSON body naming the method on `jqmethods.aspx`. */
export async function portalJq(
  jar: CookieJar,
  referer: string,
  method: string,
  data: Record<string, string | number | boolean>
): Promise<PortalPayload> {
  const res = await portalRequest(jar, `${JQ}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      referer,
      "x-requested-with": "XMLHttpRequest",
      "user-agent": UA,
    },
    body: jqBody(data),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(
      502,
      `ECAP rejected the ${method} request (HTTP ${res.status}).`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(502, `ECAP sent an unreadable reply to ${method}.`);
  }
  const reply =
    parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  if (reply.error)
    throw new HttpError(502, `ECAP reported: ${String(reply.error)}`);
  return reply.d;
}
/** The generated-proxy convention: a `.ashx` named for the page, a `_method`
 *  query parameter, and `key=value` lines. An HTML answer means the ECAP
 *  session is gone, so that is a 401 and the client signs out. */
export async function portalWebMethod(
  jar: CookieJar,
  remote: Remote,
  name: string,
  pairs: [string, string | number][]
): Promise<string> {
  const res = await portalRequest(
    jar,
    `${remote.proxy}?_method=${name}&_session=${remote.session}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: remote.referer,
        "user-agent": UA,
      },
      body: webMethodBody(pairs),
    }
  );
  const text = await res.text();
  if (!res.ok)
    throw new HttpError(502, `ECAP rejected ${name} (HTTP ${res.status}).`);
  if (looksLikeHtml(text)) {
    throw new HttpError(
      401,
      "Your ECAP session expired. Please sign in again."
    );
  }
  return unquoteJs(text);
}
