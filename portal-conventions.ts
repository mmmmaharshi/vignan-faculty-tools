/**
 * The portal's wire conventions.
 *
 * Three undocumented things about how ECAP expects to be spoken to, and the
 * cookie jar that makes any of it work. They were private methods and private
 * helpers inside `server.ts`, which exports nothing, so **no test could reach
 * any of them** - and the module header says each of them cost real time to
 * find.
 *
 * They are separated here because that is the whole of what makes them
 * testable. Nothing in this file performs I/O: the bodies are strings, the
 * cipher is a function of its input, and the cookie jar is a `Map` plus two
 * pure functions. The transport that calls them is `server.ts`'s `Portal`, and
 * that is where a second adapter would go if one were needed.
 *
 * Each convention has a comment saying what breaks if it is wrong, because
 * "it returns an empty result with no error" is the portal's failure mode and it
 * is the reason none of this can be left to be discovered at runtime.
 *
 * See docs/adr/0007-split-the-portal-conventions-from-the-transport.md.
 */

import { createCipheriv } from "node:crypto";

import type { CascadeLevel, Option } from "./shared/api";

/** The AES key, hardcoded in the portal's own page source. */
export const AES_KEY = "8701661282118308";

/**
 * Reproduce the portal's CryptoJS output: raw AES-128-CBC, base64, no salt.
 *
 * Three things are unusual and all three are load-bearing. The key is used as
 * *both* the key and the IV, because that is what the page's
 * `encryptJSText(1)` does. There is no salt header - stock CryptoJS would
 * prepend `Salted__` and a 16-byte salt, and the portal's `JSFiles/jsaes.js`
 * is a custom build that emits bare ciphertext. And the result is base64'd
 * rather than hex.
 *
 * A wrong ciphertext is not a partial failure. The portal simply never raises
 * the Click event, `frmAuth` is never issued, and a good password looks like a
 * bad one.
 */
export function portalEncrypt(plaintext: string): string {
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(AES_KEY, "utf-8"),
    Buffer.from(AES_KEY, "utf-8")
  );
  return Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]).toString("base64");
}

/**
 * The portal's `enc()`: escapes only `%` and `=`.
 *
 * Values are deliberately **not** url-encoded, which is the part that looks like
 * a bug and is not. The portal's own JavaScript does exactly this, and encoding
 * anything more would change the values it receives. Spaces and `&` go through
 * untouched.
 */
export const enc = (v: string | number): string =>
  String(v).replaceAll("%", "%26").replaceAll("=", "%3D");

/* ------------------------------------------------------------------ convention A */

/**
 * The body for a dropdown-filler call: single-quoted JSON, not a form post.
 *
 * Convention A posts to `jqmethods.aspx/<Method>` with
 * `content-type: application/json` and a body that is *almost* JSON - every key
 * and every string value is wrapped in single quotes, which is not JSON and is
 * what the portal's parser expects.
 *
 * The quote escaping is `\'`, which is also not JSON. It is what the portal
 * emits, and it is the one place a value can break the body: a student's name or
 * a subject title containing a single quote has to survive it.
 */
export function jqBody(
  data: Record<string, string | number | boolean>
): string {
  const body = Object.entries(data)
    .map(
      ([k, v]) =>
        `'${k}':${typeof v === "string" ? `'${v.replaceAll("'", "\\'")}'` : v}`
    )
    .join(",");
  return `{${body}}`;
}

/* ------------------------------------------------------------------ convention B */

/**
 * The body for a static web method: `name=value` pairs, CRLF-separated.
 *
 * Convention B posts to the proxy with `?_method=<Name>&_session=no` and a body
 * that looks like a query string but is not URL-encoded - the names, not the
 * positions, and CRLF rather than `&`.
 *
 * The order is the proxy's declared order and is not alphabetical, so the pairs
 * are passed in the order they must go out rather than sorted here.
 */
export function webMethodBody(pairs: [string, string | number][]): string {
  return pairs.map(([k, v]) => `${k}=${enc(v)}`).join("\r\n");
}

/**
 * The reply to a `ShowAcademicCalendar`, as the values to send with it.
 *
 * Every level goes twice: by identifier and by visible label. Passing only the
 * values returns **nothing at all** rather than failing, which is the single
 * most expensive behaviour this app has to work around - it is why a
 * per-session label cache existed, and why the client now sends each chosen
 * level whole.
 *
 * The subject is the one with three: identifier, visible text, and the portal's
 * own `title` attribute, which is the teaching type. `AllowPrint` is always
 * false; nothing here prints.
 */
export function calendarPairs(
  p: Record<CascadeLevel, Option> & { from: string; to: string }
): [string, string | number][] {
  return [
    ["SubjectId", p.subject.value],
    ["Section", p.section.value],
    ["Course", p.course.value],
    ["CourseName", p.course.label],
    ["Branch", p.branch.value],
    ["BranchName", p.branch.label],
    ["Semester", p.semester.value],
    ["SemesterName", p.semester.label],
    ["SubjectShortCode", p.subject.label],
    ["SubjectType", p.subject.title ?? ""],
    ["AllowPrint", "false"],
    ["fromdate", p.from],
    ["todate", p.to],
  ];
}

/* ------------------------------------------------------------------ the cookie jar */

/**
 * One signed-in user's cookies. The jar is the whole auth state: the portal
 * issues `frmAuth` on success and nothing else is needed to keep the session.
 *
 * A `Map` rather than a string because `Bun.fetch` does not store `Set-Cookie`
 * and every hop has to re-derive the header from what came back. See
 * `absorbSetCookie`.
 */
export class CookieJar {
  /** Cookie name -> value. */
  readonly entries = new Map<string, string>();

  /** The portal issues exactly this one, and its absence is what signed-out means. */
  get signedIn(): boolean {
    return this.entries.has("frmAuth");
  }

  /** The `cookie` request header, or null when the jar is empty. */
  header(): string | null {
    if (!this.entries.size) return null;
    return [...this.entries].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/**
 * Take one `Set-Cookie` value into the jar, and report whether it was usable.
 *
 * Only the first `;`-separated pair of each is kept, because the rest are
 * attributes - `Path`, `HttpOnly`, `Expires` - and storing `Path=/` as a cookie
 * called `Path` would be sent back on every request.
 *
 * Returns whether anything was stored, so a caller can notice a `Set-Cookie`
 * that arrived malformed. An empty name, or one with no `=`, is refused rather
 * than stored as an empty cookie: a jar holding `=value` is a jar whose header
 * is wrong in a way the portal will not explain.
 */
export function absorbSetCookie(
  jar: CookieJar,
  raw: string | null | undefined
): boolean {
  if (!raw) return false;
  const [pair] = raw.split(";");
  if (!pair) return false;
  const eq = pair.indexOf("=");
  if (eq <= 0) return false;
  const name = pair.slice(0, eq).trim();
  if (!name) return false;
  jar.entries.set(name, pair.slice(eq + 1).trim());
  return true;
}

/** Take every `Set-Cookie` from a response into the jar, and count the usable ones. */
export function absorbResponse(jar: CookieJar, res: Response): number {
  let taken = 0;
  // `getSetCookie` is optional in the type and absent on some runtimes, so the
  // fallback is the reason this is a function rather than a one-liner: a
  // missing header must read as "no cookies" and not as a crash.
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    if (absorbSetCookie(jar, raw)) taken += 1;
  }
  return taken;
}

/**
 * Whether a redirect should be followed, and the next URL.
 *
 * Followed by hand because `Bun.fetch` does not store `Set-Cookie`: the 302
 * after sign-in is where `frmAuth` is issued, and letting fetch follow it would
 * replay the request without the cookie that was just handed out. The portal
 * would treat the second hop as anonymous and a successful sign-in would come
 * back looking like a failure.
 *
 * A relative `Location` is resolved against the URL that produced it, which is
 * what the portal sends. A redirect with no `Location` is handed back rather than
 * guessed at, so a malformed one surfaces as the 3xx it is.
 */
export function nextHop(
  res: Response,
  from: string,
  maxHops: number
): string | null {
  if (res.status < 300 || res.status >= 400) return null;
  if (maxHops <= 0) return null;
  const loc = res.headers.get("location");
  if (!loc) return null;
  return new URL(loc, from).toString();
}
