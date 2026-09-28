/**
 * ECAP Attendance Dashboard
 * ------------------------
 * A local web app for faculty: sign in with your own ECAP credentials, pick a
 * semester / section / subject / date range, and see the class roster with
 * per-student attendance so irregular students are visible at a glance.
 *
 * Run:  bun server.ts     (then open http://127.0.0.1:8787)
 *
 * ------------------------------------------------------------------
 * How this talks to ECAP
 *
 * There is no browser. The portal is a WebForms site whose Academic Register
 * page is a client-side shell: the server renders no dropdowns at all, and the
 * page's own JavaScript builds them by calling remote methods. Everything this
 * app needs is therefore a direct HTTP call, which is why a first load takes
 * about a second instead of a minute.
 *
 * There are TWO remote-call conventions, and using the wrong one returns an
 * empty result with no error. Both were read off the live site.
 *
 *   A) Dropdown fillers - POST /vignanit/jqmethods.aspx/<Method>
 *      Content-Type: application/json; charset=utf-8
 *      body   {'courseid':1,'branchcontrolid':'ddlbranch',...}  (single-quoted)
 *      reply  JSON; the markup is in .d, an ARRAY when several divs are filled
 *      methods LoadCourses, LoadBranchAndSemestersDropDown, LoadBranchSections
 *
 *   B) Static web methods - POST {proxy}?_method=<Name>&_session=no
 *      body   CourseId=1\r\nBranchId=6\r\nSemesterId=2   (names, not positions)
 *      reply  a JavaScript literal, not JSON: a bare quoted HTML string
 *      methods FillSubjects, ShowAcademicCalendar
 *
 * The portal's enc() escapes only % and =, so values are NOT url-encoded.
 *
 * Three further details that are not obvious and cost real time to find:
 *
 *  1. The password is not posted as typed. The login field carries
 *     onkeyup="encryptJSText(1)", which runs AES-128-CBC with a key hardcoded
 *     in the page source into a hidden field; onblur="setValue(1)" then copies
 *     that ciphertext back over the visible field. So the POST carries the
 *     CIPHERTEXT in both txtPwd1 and hdnpwd1. The output is the bare
 *     ciphertext, base64'd - NOT the OpenSSL "Salted__" form that stock
 *     CryptoJS would produce. This portal's JSFiles/jsaes.js is a custom build.
 *  2. The login form on main.aspx posts to Default.aspx, not to itself, and
 *     needs __VIEWSTATE / __EVENTVALIDATION from a prior GET. The submit
 *     control is <input type="image">, so the body must carry imgBtn1.x and
 *     imgBtn1.y or ASP.NET never raises the Click event and login silently
 *     does nothing.
 *  3. ShowAcademicCalendar wants every level twice - the option's value AND its
 *     visible label (Course/CourseName, Branch/BranchName, Semester/
 *     SemesterName) plus the subject's title attribute. Passing only values
 *     returns nothing, with no error. The front end therefore sends each
 *     chosen level whole, and this server keeps no labels of its own: it used
 *     to cache them per session, which was the most fragile part of the
 *     integration and turned out to be unnecessary.
 * ------------------------------------------------------------------
 * Credential handling: the password arrives in the request body, is used once
 * to encrypt the login payload, and is never written to disk, logged, or
 * returned. There is no browser DOM to leave it in, and no stored password to
 * re-use. If the portal session dies you sign in again.
 */

import {
  absorbResponse,
  calendarPairs,
  CookieJar,
  jqBody,
  nextHop,
  portalEncrypt,
  webMethodBody,
} from "./portal-conventions";
import {
  hiddenValue,
  HttpError,
  looksLikeHtml,
  options,
  unquoteJs,
} from "./portal-replies";
import { handleOptions, handleRegister } from "./server-routes";
import type { PortalReader } from "./server-routes";
import { bunSecrets, loadSessions, saveSessions, sweep } from "./session-store";
import type { StoredSession } from "./session-store";
import type {
  CascadeLevel,
  ErrorReply,
  LoginRequest,
  OkReply,
  Option,
  OptionsRequest,
  RegisterRequest,
  SessionReply,
} from "./shared/api";

/** One position in the cascade, straight from the contract. */
type Level = CascadeLevel;

/**
 * Whatever a portal method produced.
 *
 * `any` is deliberate and load-bearing rather than lazy. `JSON.parse` gives
 * nothing better, and the payload's shape depends on which method produced it.
 * All three callers of `#jq` hand it straight to `options()`, which stringifies
 * whatever arrives, so nothing downstream depends on its type. ADR 0002 records
 * the validation that has deliberately not been done yet; this alias is the
 * first thing that changes when it is.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- the debt ADR 0002 records
type PortalPayload = any;

const PORT = Number(process.env.PORT || 8787);
const ROOT = import.meta.dir;
const DIST = `${ROOT}/dist`;

const BASE = "https://webprosindia.com";
const LOGIN_PAGE = `${BASE}/vignanit/main.aspx`;
const LOGIN_POST = `${BASE}/vignanit/Default.aspx?ReturnUrl=%2fvignanit%2fmain.aspx`;
const JQ = `${BASE}/vignanit/jqmethods.aspx`;
const REGISTER_PAGE_URL = `${BASE}/vignanit/ACADEMICS/AcademicRegister.aspx?scrid=335`;
const REGISTER_PROXY = `${BASE}/vignanit/ajax/Academics_AcademicRegister,App_Web_academicregister.aspx.a2a1b31c.ashx`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

// The AES key and the body shapes live in portal-conventions.ts, with the tests
// that hold them. The key itself is a client-side constant hardcoded in the
// portal's page source, so it protects nothing on the wire; HTTPS is what
// actually protects the password.

/**
 * How long a session survives without being used.
 *
 * Thirty days, and sliding: `getSession` stamps `at` on every request, so this is
 * a month of *not using it* rather than a month from signing in. The cookie's
 * `Max-Age` is derived from this, so the browser and the server never disagree
 * about when it ends.
 *
 * The number is deliberately longer than the ECAP session, which is why
 * `/api/session` asks the portal rather than trusting the jar. Ours is a
 * `Map` entry; theirs is whatever the portal decides, and it will not last a
 * month. See the handler.
 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 60_000;

/* ------------------------------------------------------------------ helpers */

/** A thrown value's message, without assuming it was an Error. */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * A parsed JSON value as a record, or an empty one.
 *
 * `JSON.parse` hands back `unknown`, and the portal's reply is whatever shape the
 * method that produced it implies. This narrows to something readable without an
 * assertion at the call site, and gives the empty object back when the value is
 * not an object at all - which is a reply with no `error` and no `d`.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/* ------------------------------------------------------------------ portal session */

/**
 * One signed-in user's portal, and the only thing that talks to the network.
 *
 * The jar is all the auth state there is: the portal issues frmAuth on success
 * and nothing else is needed to keep the session. Separate instances per user
 * mean two people can be signed in at once without stepping on each other.
 *
 * The wire conventions - the two calling conventions, the cipher, the body
 * shapes - are in `portal-conventions.ts`, which does no I/O and is where their
 * tests live. What stays here is the transport: carrying the cookie, absorbing
 * what comes back, and following redirects by hand.
 */
class Portal {
  /** The jar is the whole auth state; see CONTEXT.md. */
  readonly jar = new CookieJar();

  get signedIn(): boolean {
    return this.jar.signedIn;
  }

  /**
   * fetch that carries cookies and follows redirects by hand.
   *
   * Both halves matter. The cookie has to go on the FIRST request, not only on
   * redirect hops, or the jqmethods endpoints answer 401 despite a good
   * sign-in. And redirects cannot be left to fetch's own handling, because it
   * does not store Set-Cookie: the 302 after login would be replayed without
   * the frmAuth cookie that was just issued, the portal would treat it as
   * anonymous, and a successful sign-in would come back looking like a failure.
   *
   * The hop rule itself is `nextHop` in portal-conventions.ts, tested against
   * real Responses with real Location headers.
   */
  async #request(
    url: string,
    init: RequestInit = {},
    maxHops = 6
  ): Promise<Response> {
    const send = (target: string): Promise<Response> => {
      const cookie = this.jar.header();
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
    absorbResponse(this.jar, res);
    for (let hops = 0; hops < maxHops; hops++) {
      const next = nextHop(res, target, maxHops - hops);
      if (!next) break;
      target = next;
      res = await send(target);
      absorbResponse(this.jar, res);
    }
    return res;
  }

  async signIn(userId: string, password: string): Promise<void> {
    const page = await fetch(LOGIN_PAGE, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const html = await page.text();

    const cipher = portalEncrypt(password);
    const res = await this.#request(LOGIN_POST, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: LOGIN_PAGE,
        origin: BASE,
        "user-agent": UA,
      },
      body: new URLSearchParams({
        __VIEWSTATE: hiddenValue(html, "__VIEWSTATE"),
        __VIEWSTATEGENERATOR: hiddenValue(html, "__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: hiddenValue(html, "__EVENTVALIDATION"),
        txtId1: userId,
        txtPwd1: cipher,
        hdnpwd1: cipher,
        "imgBtn1.x": "12",
        "imgBtn1.y": "12",
      }),
    });
    await res.text();

    if (!this.signedIn) {
      throw new HttpError(
        401,
        "Sign-in failed. Check your ECAP user name and password."
      );
    }
  }

  /** Convention A: the `.d` payload, which may be a string or an array. */
  async #jq(
    method: string,
    data: Record<string, string | number | boolean>
  ): Promise<PortalPayload> {
    const res = await this.#request(`${JQ}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        referer: REGISTER_PAGE_URL,
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
    const reply = asRecord(parsed);
    if (reply.error)
      throw new HttpError(502, `ECAP reported: ${String(reply.error)}`);
    return reply.d;
  }

  /** Convention B. `pairs` is [name, value] in the proxy's declared order. */
  async #webMethod(
    name: string,
    pairs: [string, string | number][]
  ): Promise<string> {
    const res = await this.#request(
      `${REGISTER_PROXY}?_method=${name}&_session=no`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          referer: REGISTER_PAGE_URL,
          "user-agent": UA,
        },
        body: webMethodBody(pairs),
      }
    );
    const text = await res.text();
    if (!res.ok)
      throw new HttpError(502, `ECAP rejected ${name} (HTTP ${res.status}).`);
    // Convention B is the quiet one: its reply is a JavaScript literal, so a
    // dead session's markup arrives here looking like data and ends up as an
    // empty level or an empty register. 401 bounces the front end to the login
    // screen, which is the right place for it.
    if (looksLikeHtml(text)) {
      throw new HttpError(
        401,
        "Your ECAP session expired. Please sign in again."
      );
    }
    return unquoteJs(text);
  }

  /* ---- the cascade ---- */

  async courses(): Promise<Option[]> {
    return options(
      await this.#jq("LoadCourses", {
        controlid: "ddlcourse",
        onchangemethod: "",
        isdefaultall: false,
      })
    );
  }

  /**
   * The reading half, which is all the route handlers need.
   *
   * Exposed as a property rather than by widening the class, so the dependency
   * the handlers declare is the small one: a handler cannot sign in, cannot
   * hold a jar and cannot make a request of its own. `PortalReader` is the
   * interface, `Portal` is the first adapter, and a test's fake is the second.
   */
  get reader(): PortalReader {
    return this;
  }

  /** Branches and semesters arrive together, as d[0] and d[1]. */
  async branchesAndSemesters(
    courseId: string | number
  ): Promise<[Option[], Option[]]> {
    const d = await this.#jq("LoadBranchAndSemestersDropDown", {
      courseid: Number(courseId),
      branchcontrolid: "ddlbranch",
      branchonchangemethod: "",
      branchdefaultall: false,
      semestercontrolid: "ddlsemester",
      semesteronchangemethod: "",
      semesterdefaultall: false,
      semesterorbatch: "S",
    });
    return [options(d?.[0]), options(d?.[1])];
  }

  /**
   * Sections need a batch number, which the page reads from the chosen semester
   * option's title attribute. IV Semester ships an empty title, so fall back to
   * the semester's own value rather than sending a blank batch. Both arrive from
   * the client, which is the only side still holding the option.
   */
  async sections(
    courseId: string | number,
    branchId: string | number,
    semester: string | number,
    semesterTitle?: string
  ): Promise<Option[]> {
    const batch = semesterTitle || semester;
    return options(
      await this.#jq("LoadBranchSections", {
        courseid: Number(courseId),
        branchid: Number(branchId),
        batch: Number(batch) || 0,
        defaulttext: "Select",
        controlid: "ddlsection",
      })
    );
  }

  async subjects(
    courseId: string | number,
    branchId: string | number,
    semesterId: string | number
  ): Promise<Option[]> {
    return options(
      await this.#webMethod("FillSubjects", [
        ["CourseId", courseId],
        ["BranchId", branchId],
        ["SemesterId", semesterId],
      ])
    );
  }

  /**
   * Every level is needed twice over - by value and by visible label - plus the
   * subject's title. `calendarPairs` builds that, and is tested; see
   * portal-conventions.ts and the module header, note 3.
   */
  register(
    p: Record<Level, Option> & { from: string; to: string }
  ): Promise<string> {
    return this.#webMethod("ShowAcademicCalendar", calendarPairs(p));
  }
}

/* ------------------------------------------------------------------ sessions */

/** One signed-in user: their portal jar. */
type Session = {
  /** Last seen, for the TTL sweep. Touched on every request. */
  at: number;
  portal: Portal;
};

const sessions = new Map<string, Session>();

/**
 * Where the sessions are written, and how often.
 *
 * Sixty seconds is not a guess about durability, it is a statement that the
/**
 * How often the vault is written when nothing structural has changed.
 *
 * Sixty seconds is a statement about the *timestamp's* precision, not about
 * durability. `at` is stamped on every request, and persisting it to the nearest
 * minute against a thirty-day window changes nothing anybody can observe - so
 * there is no reason to write on each one.
 *
 * Sign-in and sign-out are the exceptions and are flushed immediately, because
 * those are the two moments where losing the write is actually noticed: one loses
 * a session the user believes they created, the other loses an ending they
 * believe they performed. Leaving either to the tick meant a restart could undo
 * it. See `flushSessions`'s callers and ADR 0014.
 */
const SESSION_FLUSH_MS = 60_000;

/**
 * The OS credential vault, or null if this runtime has none.
 *
 * Null is a supported state, not a failure: persistence is a convenience, so a
 * build without `Bun.secrets` keeps today's behaviour — sessions in memory, gone
 * on restart — instead of refusing to start. The banner says which one you got.
 */
const vault = bunSecrets();

/** Set when the in-memory map and the vault disagree; cleared by a good write. */
let storeDirty = false;

function markStoreDirty() {
  storeDirty = true;
}

/**
 * Forget a session, and record that the vault now disagrees with the map.
 *
 * Three callers need exactly this - a deliberate sign-out, an expired portal jar,
 * and the probe's 401 - and writing `if (id && sessions.delete(id))
 * markStoreDirty()` at each of them is how one of them ends up forgetting the
 * second half. That is not hypothetical: sign-out shipped calling `sessions.delete`
 * without the flag, and then without the flush, and a restart resurrected the
 * session the user had just ended.
 *
 * Returns whether anything was removed, so a caller can decide a write is needed.
 */
function dropSession(id: string | null): boolean {
  if (!id) return false;
  const removed = sessions.delete(id);
  if (removed) markStoreDirty();
  return removed;
}

/**
 * The session cookie, re-issued on every authenticated response.
 *
 * The server's session **slides**: `at` is stamped on every request, so a
 * thirty-day-old session used every day is still alive. The browser's cookie did
 * not. It was written once at sign-in with a thirty-day `Max-Age` and never
 * refreshed, so a user who opened the app daily was signed out on day thirty-one
 * anyway - the feature failing for exactly the person it was built for, while the
 * docs claimed the two could not disagree.
 *
 * Re-issuing on every authenticated response is what makes `Max-Age` mean
 * *thirty days from your last use*, which is the only reading that matches the
 * server. The browser has no other way to know the app is in use, and every
 * authenticated request is that signal. One header, and no state to track.
 */
function refreshedCookie(id: string): Record<string, string> {
  return {
    "set-cookie": `ecap_sid=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
  };
}

/** The map, reduced to the shape the store writes. */
function snapshotSessions(): StoredSession[] {
  return [...sessions].map(([id, s]) => ({
    id,
    at: s.at,
    cookies: [...s.portal.jar.entries],
  }));
}

/**
 * Write the vault, if it is out of date.
 *
 * A failure is logged and the flag stays set, so the next tick tries again. It is
 * deliberately not fatal: the in-memory session is the live one, and the vault
 * only exists so the *next* boot is convenient. Losing it costs one sign-in, and
 * refusing to serve a working session over a failed convenience write would be
 * the worse trade.
 */
async function flushSessions(): Promise<void> {
  if (!vault || !storeDirty) return;
  const problem = await saveSessions(vault, snapshotSessions());
  if (problem) {
    console.error(`[sessions] ${problem}`);
    return;
  }
  storeDirty = false;
}

/** Rebuild a session from the vault. The jar is the whole auth state; see CONTEXT.md. */
function restoreSession(stored: StoredSession): Session {
  const portal = new Portal();
  for (const [name, value] of stored.cookies)
    portal.jar.entries.set(name, value);
  return { at: stored.at, portal };
}

function reapSessions() {
  const now = Date.now();
  let dropped = false;
  for (const [id, s] of sessions) {
    if (now - s.at > SESSION_TTL_MS) {
      sessions.delete(id);
      dropped = true;
    }
  }
  if (dropped) markStoreDirty();
}

/**
 * Load whatever survived the last run, then sweep.
 *
 * The sweep runs after the load, not before, because an entry written three weeks
 * ago by a build with a shorter TTL should be held to *this* build's TTL rather
 * than restored on trust. Anything past it is dropped and never written back, so
 * a stale token cannot accumulate in the vault across restarts.
 */
async function restoreSessions(): Promise<{
  restored: number;
  dropped: number;
  persisted: boolean;
}> {
  if (!vault) return { restored: 0, dropped: 0, persisted: false };
  const loaded = await loadSessions(vault);
  const { kept, dropped } = sweep(loaded, Date.now(), SESSION_TTL_MS);
  for (const stored of kept) {
    if (sessions.has(stored.id)) continue;
    sessions.set(stored.id, restoreSession(stored));
  }
  if (dropped) markStoreDirty();
  return { restored: kept.length, dropped, persisted: true };
}

function getSession(id: string | null): Session | null {
  if (!id) return null;
  reapSessions();
  const s = sessions.get(id);
  if (!s) return null;
  // The sliding stamp is a change worth recording, but not one worth a write on
  // its own - `flushSessions` collects them into the next tick.
  s.at = Date.now();
  markStoreDirty();
  return s;
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function requireSession(req: Request): Session {
  const id = readCookie(req, "ecap_sid");
  const s = getSession(id);
  if (!s)
    throw new HttpError(401, "Your session expired. Please sign in again.");
  if (!s.portal.signedIn) {
    // The jar is dead. Drop it rather than leave it to fail again next request.
    dropSession(id);
    throw new HttpError(
      401,
      "Your ECAP session expired. Please sign in again."
    );
  }
  return s;
}

/* ------------------------------------------------------------------ http */

/**
 * The built index.html, for `/` and for every client-side route.
 *
 * `no-store`, not the immutable caching the hashed assets get, because this is
 * the document that points at them: a cached index.html keeps referencing the
 * previous bundle and a rebuild looks like it silently did nothing. ADR 0004
 * records that pair as a decision.
 */
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

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  // The charset is spelled out rather than left to Response.json's default,
  // because student names come back from the portal and the browser is told how
  // to read them.
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * Read a JSON request body as `T`.
 *
 * An assertion, not a validation, and worth being precise about why. The front
 * end is compiled against the very same declarations in `shared/api.ts`, so a
 * field it cannot spell is a build error on that side. What this cannot catch
 * is a hand-rolled request from something other than this app - which is not a
 * case that exists here: the server binds to 127.0.0.1 and serves one user.
 *
 * The portal seam is a different matter and is deliberately not narrowed like
 * this. See `#jq` and ADR 0002.
 *
 * A body that will not parse is treated as an empty one, which every caller
 * already handles by rejecting the missing fields.
 */
async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

/**
 * Restore, sweep, and start the flush tick — all before `Bun.serve`.
 *
 * Order matters, and the top-level `await` is what enforces it. `Bun.serve`
 * begins listening the moment it is called, so a restore placed after it leaves a
 * window in which a request finds an empty map and signs a signed-in user out.
 * The await is what makes "before" real rather than a comment.
 */
const restoredSessions = await restoreSessions();
// `flushSessions` reports failure through its return value and never rejects, so
// an async tick cannot produce an unhandled rejection.
setInterval(async () => {
  await flushSessions();
}, SESSION_FLUSH_MS);

// A sign-out or a sign-in that has not reached the tick yet should not be lost
// to Ctrl-C. `flushSessions` is a no-op when nothing is dirty, so this costs
// nothing on the common path.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await flushSessions();
    process.exit(0);
  });
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      /* ---- static: the built front end ----
       *
       * Vite emits hashed asset filenames into dist/, so those are safe to cache
       * hard. index.html is not, because it is what points at them: a cached
       * index.html keeps referencing the previous bundle, and a rebuild looks
       * like it silently did nothing.
       */
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        return indexHtml();
      }
      if (req.method === "GET" && path === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      if (req.method === "GET" && !path.startsWith("/api/")) {
        // Vite's hashed bundle. A miss here is a typo or a deep link, so the
        // distinction is made below rather than by returning HTML for both.
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

        /**
         * Client-side routes are not files.
         *
         * The front end has two screens, `/login` and `/dashboard`, and the router
         * picks between them in the browser - so a reload of either, a bookmark or
         * a link to either has to reach index.html. Without this a deep link 404s
         * before any JavaScript runs, and the back button leaves the app entirely.
         *
         * `/dashboard` is the canonical address; `/` also serves the shell and the
         * client sends it on to whichever screen the session calls for. That is
         * why the check is `!path.includes(".")` and not a list of known routes.
         *
         * Only for paths that could be a route: a request for a missing file
         * under `/assets/` is a genuine typo in a build, and answering it with
         * HTML would turn a broken bundle reference into a confusing parse error
         * in the browser instead of a clear 404 here. `/api/` is excluded above
         * and falls through to the JSON 404.
         */
        if (!path.includes(".")) {
          return indexHtml();
        }
      }

      /* ---- sign in ---- */
      if (req.method === "POST" && path === "/api/login") {
        const { userId, password } = await readJson<LoginRequest>(req);
        if (!userId || !password)
          throw new HttpError(400, "Enter your user name and password.");

        reapSessions();
        const portal = new Portal();
        try {
          await portal.signIn(String(userId), String(password));
        } catch (error) {
          // Nothing to salvage from a failed attempt, so drop the jar entirely.
          throw error instanceof HttpError
            ? error
            : new HttpError(502, messageOf(error));
        }

        const id = crypto.randomUUID();
        sessions.set(id, { at: Date.now(), portal });
        // Flushed here rather than left to the tick: this is the one write whose
        // loss is immediately visible, because the next boot would ask for a
        // password the user believes they already gave.
        markStoreDirty();
        await flushSessions();
        return json({ ok: true } satisfies OkReply, 200, refreshedCookie(id));
      }

      if (req.method === "POST" && path === "/api/logout") {
        const id = readCookie(req, "ecap_sid");
        // Awaited, not left to the tick. Leaving it to the tick meant a sign-out
        // followed by a hard kill inside sixty seconds restored the session on the
        // next boot - the exact thing the user asked to stop happening, and the
        // reason the sign-out path is the one place that cannot defer its write.
        // The signal handlers do not help: they cover a graceful Ctrl-C, not
        // Task Manager or a power cut.
        if (dropSession(id)) await flushSessions();
        return json({ ok: true } satisfies OkReply, 200, {
          "set-cookie": "ecap_sid=; Path=/; Max-Age=0",
        });
      }

      /* ---- everything below needs a signed-in session ---- */
      if (path.startsWith("/api/")) {
        if (path === "/api/session") {
          // Probe the session, and do not require the portal cookie, so a stale
          // page can tell "not signed in" from "expired".
          const id = readCookie(req, "ecap_sid");
          const s = getSession(id);
          if (!s) return json({ signedIn: false } satisfies SessionReply, 200);
          // Ask the portal, rather than trusting the jar. With a 30-day session
          // the ECAP session dies long before ours does, and `jar.signedIn`
          // only means "an frmAuth cookie is in the jar" - it stays true after
          // the portal has forgotten us. Trusting it would show a signed-in
          // dashboard that then failed every call, which is the one thing a
          // session probe exists to prevent.
          //
          // `courses()` is the cheapest call that genuinely goes to the portal.
          //
          // What this does and does not catch, stated plainly because it is the
          // limit of the check rather than a detail: only a 401 evicts. A dead
          // session is detected on convention B, which inspects its reply for
          // HTML and answers 401 (see `#webMethod`). Convention A has no such
          // check, so a dead session there arrives as a 502 - an unreadable or
          // errored reply - and a 502 is ambiguous. It could equally be a portal
          // that is down, or markup that has moved. Signing the user out on
          // that would turn a transient outage into a lost session, which is
          // precisely the trade ADR 0002 refused when it chose `emptyLevels`
          // over a 502. So a 502 is reported as signed-in and the real request
          // surfaces it.
          //
          // The guaranteed path is therefore unchanged: a dead session is caught
          // by the 401 on the next convention-B call, which is what
          // `/api/register` and `/api/options`'s subject step do. This probe
          // turns that from "the first thing the user does fails" into "the
          // dashboard notices first".
          try {
            await s.portal.courses();
          } catch (error) {
            if (error instanceof HttpError && error.status === 401) {
              // The jar is dead. Drop it rather than make the next request
              // discover the same thing.
              if (dropSession(id)) await flushSessions();
              return json({ signedIn: false } satisfies SessionReply, 200);
            }
          }
          return json(
            { signedIn: s.portal.signedIn } satisfies SessionReply,
            200,
            // The probe runs every five minutes, so a tab left open keeps rolling
            // its cookie forward without anyone touching it.
            id ? refreshedCookie(id) : undefined
          );
        }

        const s = requireSession(req);
        const { portal } = s;
        // Re-issued on both data endpoints and on the probe above, so a tab in
        // active use keeps its `Max-Age` rolling forward. See `refreshedCookie`.
        const id = readCookie(req, "ecap_sid");
        const cookie = id ? refreshedCookie(id) : undefined;

        // The decision-making lives in server-routes.ts, where it can be tested
        // without booting a server. What is left here is routing: this handler
        // decides which function runs and hands it a portal it can read from.
        if (req.method === "POST" && path === "/api/options") {
          return json(
            await handleOptions(
              portal.reader,
              await readJson<OptionsRequest>(req)
            ),
            200,
            cookie
          );
        }

        if (req.method === "POST" && path === "/api/register") {
          return json(
            await handleRegister(
              portal.reader,
              await readJson<RegisterRequest>(req)
            ),
            200,
            cookie
          );
        }

        return json({ error: "Not found" } satisfies ErrorReply, 404);
      }

      return json({ error: "Not found" } satisfies ErrorReply, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error("[error]", messageOf(error));
      return json(
        { error: messageOf(error) || "Something went wrong." },
        status
      );
    }
  },
});

console.log(`\n  ECAP Attendance Dashboard`);
console.log(`  http://127.0.0.1:${server.port}\n`);
console.log(`  Talking to ECAP over HTTPS directly - no browser is launched.`);
console.log(
  `  Your password is used once to sign in and is never written to disk.`
);
console.log(
  restoredSessions.persisted
    ? `  Sign-in tokens are kept in the OS credential vault, so a restart keeps you signed in.`
    : `  No OS credential vault on this runtime, so a restart signs you out.`
);
console.log(
  `  ${
    restoredSessions.restored
      ? `Restored ${restoredSessions.restored} signed-in session(s)${
          restoredSessions.dropped
            ? `, dropped ${restoredSessions.dropped} that had expired`
            : ""
        }.`
      : `No saved sessions found.`
  }\n`
);
