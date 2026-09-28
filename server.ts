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

import { createCipheriv } from "node:crypto";
import { readdirSync } from "node:fs";
import type {
  ErrorReply,
  LoginRequest,
  OkReply,
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  SessionReply,
  Student,
} from "./shared/api";
import {
  expectLevel,
  hiddenValue,
  HttpError,
  looksLikeHtml,
  options,
  parseRegister,
  realOptions,
  unquoteJs,
} from "./portal-replies";
import type { RegisterRow } from "./portal-replies";

/** One position in the cascade. Derived from the contract, so the two cannot drift. */
type Level = keyof OptionsReply;

const PORT = Number(process.env.PORT || 8787);
const ROOT = import.meta.dir;
const DIST = ROOT + "/dist";

const BASE = "https://webprosindia.com";
const LOGIN_PAGE = BASE + "/vignanit/main.aspx";
const LOGIN_POST = BASE + "/vignanit/Default.aspx?ReturnUrl=%2fvignanit%2fmain.aspx";
const JQ = BASE + "/vignanit/jqmethods.aspx";
const REGISTER_PROXY =
  BASE + "/vignanit/ajax/Academics_AcademicRegister,App_Web_academicregister.aspx.a2a1b31c.ashx";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

// Hardcoded in the portal's page source. It is a client-side constant, so it
// protects nothing on the wire; HTTPS is what actually protects the password.
const AES_KEY = "8701661282118308";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const IRREGULAR_BELOW = 75; // attendance % considered irregular
const CRITICAL_BELOW = 60;  // attendance % considered critical
const HTTP_TIMEOUT_MS = 60_000;

/* ------------------------------------------------------------------ portal session */

/**
 * One cookie jar per signed-in user.
 *
 * A jar is all the auth state there is: the portal issues frmAuth on success
 * and nothing else is needed to keep the session. Separate jars per user mean
 * two people can be signed in at once without stepping on each other.
 */
class Portal {
  /** Cookie name -> value. The jar is the whole auth state; see CONTEXT.md. */
  cookies = new Map<string, string>();

  get signedIn(): boolean {
    return this.cookies.has("frmAuth");
  }

  #cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  #absorb(res: Response): void {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
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
   */
  async #request(url: string, init: RequestInit = {}, maxHops = 6): Promise<Response> {
    const withCookie = (headers: RequestInit["headers"]): Record<string, string> => ({
      ...Object.fromEntries(new Headers(headers).entries()),
      ...(this.#cookieHeader() ? { cookie: this.#cookieHeader() } : {}),
    });

    let target = url;
    let res = await fetch(target, {
      ...init,
      headers: withCookie(init.headers),
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    this.#absorb(res);
    for (let i = 0; res.status >= 300 && res.status < 400 && i < maxHops; i++) {
      const loc = res.headers.get("location");
      if (!loc) break;
      target = new URL(loc, target).toString();
      res = await fetch(target, {
        headers: withCookie(init.headers),
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      this.#absorb(res);
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
      throw new HttpError(401, "Sign-in failed. Check your ECAP user name and password.");
    }
  }

  /**
   * Convention A. Returns the `.d` payload, which may be a string or an array.
   *
   * `any` here is deliberate and load-bearing rather than lazy. `JSON.parse`
   * gives nothing better, and the payload's shape depends on which portal method
   * produced it. All three callers below hand it straight to `options()`, which
   * stringifies whatever arrives, so nothing downstream depends on its type.
   * ADR 0002 records the validation that has deliberately not been done yet;
   * this return type is the first thing that changes when it is.
   */
  async #jq(method: string, data: Record<string, string | number | boolean>): Promise<any> {
    const body = Object.entries(data)
      .map(([k, v]) => `'${k}':${typeof v === "string" ? `'${v.replace(/'/g, "\\'")}'` : v}`)
      .join(",");
    const res = await this.#request(`${JQ}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        referer: REGISTER_PAGE_URL,
        "x-requested-with": "XMLHttpRequest",
        "user-agent": UA,
      },
      body: `{${body}}`,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(502, `ECAP rejected the ${method} request (HTTP ${res.status}).`);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new HttpError(502, `ECAP sent an unreadable reply to ${method}.`);
    }
    if (json.error) throw new HttpError(502, `ECAP reported: ${json.error}`);
    return json.d;
  }

  /** Convention B. `pairs` is [name, value] in the proxy's declared order. */
  async #webMethod(name: string, pairs: [string, string | number][]): Promise<string> {
    const body = pairs.map(([k, v]) => `${k}=${enc(v)}`).join("\r\n");
    const res = await this.#request(`${REGISTER_PROXY}?_method=${name}&_session=no`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: REGISTER_PAGE_URL,
        "user-agent": UA,
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(502, `ECAP rejected ${name} (HTTP ${res.status}).`);
    // Convention B is the quiet one: its reply is a JavaScript literal, so a
    // dead session's markup arrives here looking like data and ends up as an
    // empty level or an empty register. 401 bounces the front end to the login
    // screen, which is the right place for it.
    if (looksLikeHtml(text)) {
      throw new HttpError(401, "Your ECAP session expired. Please sign in again.");
    }
    return unquoteJs(text);
  }

  /* ---- the cascade ---- */

  async courses(): Promise<Option[]> {
    return options(
      await this.#jq("LoadCourses", { controlid: "ddlcourse", onchangemethod: "", isdefaultall: false }),
    );
  }

  /** Branches and semesters arrive together, as d[0] and d[1]. */
  async branchesAndSemesters(courseId: string | number): Promise<[Option[], Option[]]> {
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
    semesterTitle?: string,
  ): Promise<Option[]> {
    const batch = semesterTitle ? semesterTitle : semester;
    return options(
      await this.#jq("LoadBranchSections", {
        courseid: Number(courseId),
        branchid: Number(branchId),
        batch: Number(batch) || 0,
        defaulttext: "Select",
        controlid: "ddlsection",
      }),
    );
  }

  async subjects(
    courseId: string | number,
    branchId: string | number,
    semesterId: string | number,
  ): Promise<Option[]> {
    return options(
      await this.#webMethod("FillSubjects", [
        ["CourseId", courseId],
        ["BranchId", branchId],
        ["SemesterId", semesterId],
      ]),
    );
  }

  /**
   * Every level is needed twice over - by value and by visible label - plus the
   * subject's title. See the module header, note 3.
   */
  async register(p: Record<Level, Option> & { from: string; to: string }): Promise<string> {
    return this.#webMethod("ShowAcademicCalendar", [
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
    ]);
  }
}

const REGISTER_PAGE_URL = BASE + "/vignanit/ACADEMICS/AcademicRegister.aspx?scrid=335";

/* ------------------------------------------------------------------ helpers */

/** Reproduce the portal's CryptoJS output: raw AES-128-CBC, base64, no salt. */
function portalEncrypt(plaintext: string): string {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(AES_KEY, "utf8"), Buffer.from(AES_KEY, "utf8"));
  return Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]).toString("base64");
}

/** The portal's enc(): escapes only % and =. Values are deliberately not url-encoded. */
const enc = (v: string | number): string =>
  String(v).replace(/%/g, "%26").replace(/=/g, "%3D");

/* ------------------------------------------------------------------ sessions */

/** One signed-in user: their portal jar. */
type Session = {
  /** Last seen, for the TTL sweep. Touched on every request. */
  at: number;
  portal: Portal;
};

const sessions = new Map<string, Session>();

function reapSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.at > SESSION_TTL_MS) sessions.delete(id);
  }
}

function getSession(id: string | null): Session | null {
  if (!id) return null;
  reapSessions();
  const s = sessions.get(id);
  if (!s) return null;
  s.at = Date.now();
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
  if (!s) throw new HttpError(401, "Your session expired. Please sign in again.");
  if (!s.portal.signedIn) {
    // The jar is dead. Drop it rather than leave it to fail again next request.
    if (id) sessions.delete(id);
    throw new HttpError(401, "Your ECAP session expired. Please sign in again.");
  }
  return s;
}

/**
 * The level the client named, checked for both halves.
 *
 * `ShowAcademicCalendar` needs every level by identifier *and* by visible text,
 * and returns nothing at all rather than failing when a label is missing. So
 * both are checked here, where the message can name the level that is wrong.
 */
function chosenLevel(b: Partial<RegisterRequest>, key: Level): Option {
  const o = b[key];
  if (!o?.value || !o.label) throw new HttpError(400, `Choose a ${key}.`);
  return o;
}

/* ------------------------------------------------------------------ http */

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
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

/** A thrown value's message, without assuming it was an Error. */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
        const index = Bun.file(DIST + "/index.html");
        if (!(await index.exists())) {
          return new Response("The front end has not been built yet.\n\nRun:  bun run build\n", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        return new Response(index, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store, must-revalidate",
          },
        });
      }
      if (req.method === "GET" && path === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      if (req.method === "GET" && !path.startsWith("/api/")) {
        // Vite's hashed bundle. A miss here is a typo rather than a route, so
        // fall through to 404 instead of quietly returning HTML for it.
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
      }

      /* ---- sign in ---- */
      if (req.method === "POST" && path === "/api/login") {
        const { userId, password } = await readJson<LoginRequest>(req);
        if (!userId || !password) throw new HttpError(400, "Enter your user name and password.");

        reapSessions();
        const portal = new Portal();
        try {
          await portal.signIn(String(userId), String(password));
        } catch (e) {
          // Nothing to salvage from a failed attempt, so drop the jar entirely.
          throw e instanceof HttpError ? e : new HttpError(502, messageOf(e));
        }

        const id = crypto.randomUUID();
        sessions.set(id, { at: Date.now(), portal });
        return json(
          { ok: true } satisfies OkReply,
          200,
          { "set-cookie": `ecap_sid=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}` },
        );
      }

      if (req.method === "POST" && path === "/api/logout") {
        const id = readCookie(req, "ecap_sid");
        if (id) sessions.delete(id);
        return json({ ok: true } satisfies OkReply, 200, { "set-cookie": "ecap_sid=; Path=/; Max-Age=0" });
      }

      /* ---- everything below needs a signed-in session ---- */
      if (path.startsWith("/api/")) {
        if (path === "/api/session") {
          // Probe the session but do not require the portal cookie, so a stale
          // page can tell the difference between "not signed in" and "expired".
          const s = getSession(readCookie(req, "ecap_sid"));
          if (!s) return json({ signedIn: false } satisfies SessionReply, 200);
          return json({ signedIn: s.portal.signedIn } satisfies SessionReply, 200);
        }

        const s = requireSession(req);
        const portal = s.portal;

        /**
         * The whole selection is sent each time; only the levels that are now
         * derivable get filled, and deeper ones come back empty so the front
         * end can disable them.
         */
        if (req.method === "POST" && path === "/api/options") {
          const b = await readJson<OptionsRequest>(req);
          // Typed as the contract, so the five assignments below are checked
          // against the same shape the front end reads.
          const out: OptionsReply = { course: [], semester: [], branch: [], section: [], subject: [] };

          out.course = expectLevel(realOptions(await portal.courses()), "courses");

          if (b.course) {
            const [branches, semesters] = await portal.branchesAndSemesters(b.course);
            out.branch = expectLevel(realOptions(branches), "branches");
            out.semester = expectLevel(realOptions(semesters), "semesters");
          }
          // Sections and subjects are deliberately not guarded. Some
          // combinations genuinely teach nothing, and an empty level is the
          // honest answer for those. See docs/adr/0003.
          if (b.course && b.branch && b.semester) {
            out.section = realOptions(
              await portal.sections(b.course, b.branch, b.semester, b.semesterTitle),
            );
          }
          if (b.course && b.branch && b.semester && b.section) {
            out.subject = realOptions(await portal.subjects(b.course, b.branch, b.semester));
          }
          return json(out);
        }

        if (req.method === "POST" && path === "/api/register") {
          const b = await readJson<RegisterRequest>(req);
          if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");

          // Every level arrives whole, because the client is the only side that
          // still holds the labels. Checked here, per level, so the message can
          // name the one that is wrong.
          const p: Record<Level, Option> = {
            course: chosenLevel(b, "course"),
            semester: chosenLevel(b, "semester"),
            branch: chosenLevel(b, "branch"),
            section: chosenLevel(b, "section"),
            subject: chosenLevel(b, "subject"),
          };
          const { from, to } = b;

          const rows = parseRegister(await portal.register({ ...p, from: b.from, to: b.to }));
          if (!rows.length) {
            throw new HttpError(
              502,
              "The register came back empty. Either the subject has no classes in that date range, or ECAP's page layout has changed.",
            );
          }

          const withFlags: Student[] = rows.map((r) => ({
            ...r,
            irregular: r.pct != null && r.pct < IRREGULAR_BELOW,
            critical: r.pct != null && r.pct < CRITICAL_BELOW,
          }));
          // The predicate is what lets the average below add without a null
          // check: a plain filter leaves `pct` as number | null either way.
          const counted = withFlags.filter((r): r is Student & { pct: number } => r.pct != null);
          const total = withFlags.length;

          return json({
            students: withFlags,
            summary: {
              total,
              irregular: withFlags.filter((r) => r.irregular).length,
              critical: withFlags.filter((r) => r.critical).length,
              // Sent so the client labels the cards from the same numbers that
              // produced the flags, instead of hardcoding them in two places.
              irregularBelow: IRREGULAR_BELOW,
              criticalBelow: CRITICAL_BELOW,
              average: counted.length
                ? Math.round((counted.reduce((a, r) => a + r.pct, 0) / counted.length) * 10) / 10
                : null,
              range: { from, to },
            },
          } satisfies RegisterReply);
        }

        return json({ error: "Not found" } satisfies ErrorReply, 404);
      }

      return json({ error: "Not found" } satisfies ErrorReply, 404);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[error]", messageOf(e));
      return json({ error: messageOf(e) || "Something went wrong." }, status);
    }
  },
});

console.log(`\n  ECAP Attendance Dashboard`);
console.log(`  http://127.0.0.1:${server.port}\n`);
console.log(`  Talking to ECAP over HTTPS directly - no browser is launched.`);
console.log(`  Your password is used once to sign in and is never stored.\n`);

