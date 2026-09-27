/**
 * ECAP Attendance Dashboard
 * ------------------------
 * A local web app for faculty: sign in with your own ECAP credentials, pick a
 * semester / section / subject / date range, and see the class roster with
 * per-student attendance so irregular students are visible at a glance.
 *
 * Run:  bun server.js     (then open http://127.0.0.1:8787)
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
 *     returns nothing. Labels are therefore cached per session as the
 *     dropdowns are filled, because the browser sends values only.
 * ------------------------------------------------------------------
 * Credential handling: the password arrives in the request body, is used once
 * to encrypt the login payload, and is never written to disk, logged, or
 * returned. There is no browser DOM to leave it in, and no stored password to
 * re-use. If the portal session dies you sign in again.
 */

import { createCipheriv } from "node:crypto";
import { readdirSync } from "node:fs";

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
const CLASS_CAP = 75;
const HTTP_TIMEOUT_MS = 60_000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ------------------------------------------------------------------ portal session */

/**
 * One cookie jar per signed-in user.
 *
 * A jar is all the auth state there is: the portal issues frmAuth on success
 * and nothing else is needed to keep the session. Separate jars per user mean
 * two people can be signed in at once without stepping on each other.
 */
class Portal {
  constructor() {
    this.cookies = new Map();
  }

  get signedIn() {
    return this.cookies.has("frmAuth");
  }

  #cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  #absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
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
  async #request(url, init = {}, maxHops = 6) {
    const withCookie = (headers) => ({
      ...headers,
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

  async signIn(userId, password) {
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
    return true;
  }

  /** Convention A. Returns the .d payload, which may be a string or an array. */
  async #jq(method, data) {
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
  async #webMethod(name, pairs) {
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
    return unquoteJs(text);
  }

  /* ---- the cascade ---- */

  async courses() {
    return options(
      await this.#jq("LoadCourses", { controlid: "ddlcourse", onchangemethod: "", isdefaultall: false }),
    );
  }

  /** Branches and semesters arrive together, as d[0] and d[1]. */
  async branchesAndSemesters(courseId) {
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
   * Sections need a batch number, which the page reads from the chosen
   * semester option's title attribute. IV Semester ships an empty title, so
   * fall back to the semester's own value rather than sending a blank batch.
   */
  async sections(courseId, branchId, semester) {
    const batch = semester?.title !== "" && semester?.title != null
      ? semester.title
      : semester?.value;
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

  async subjects(courseId, branchId, semesterId) {
    return options(
      await this.#webMethod("FillSubjects", [
        ["CourseId", courseId],
        ["BranchId", branchId],
        ["SemesterId", semesterId],
      ]),
    );
  }

  async register(p) {
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
function portalEncrypt(plaintext) {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(AES_KEY, "utf8"), Buffer.from(AES_KEY, "utf8"));
  return Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]).toString("base64");
}

/** The portal's enc(): escapes only % and =. Values are deliberately not url-encoded. */
const enc = (v) => String(v).replace(/%/g, "%26").replace(/=/g, "%3D");

function hiddenValue(html, name) {
  for (const tag of html.match(/<input[^>]*>/gi) ?? []) {
    if (new RegExp(`name="${name}"`, "i").test(tag)) {
      return tag.match(/value="([^"]*)"/i)?.[1] ?? "";
    }
  }
  return "";
}

/**
 * Unwrap the portal's JavaScript-literal reply.
 *
 * Convention B answers with a bare single-quoted HTML string that the page's
 * ajax_response eval()s into {error, value}. It is not JSON, so JSON.parse on
 * it fails and the value has to be unwrapped by hand.
 */
function unquoteJs(text) {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t);
      return j.value ?? j.d ?? t;
    } catch { /* not JSON after all */ }
  }
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t
      .slice(1, -1)
      .replace(/\\(['"\\])/g, "$1")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n");
  }
  return t;
}

/** Read a <select> fragment into {value, label, title} options. */
function options(html) {
  const out = [];
  for (const m of String(html ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const attrs = m[1];
    const pick = (n) =>
      attrs.match(new RegExp(`${n}\\s*=\\s*'([^']*)'`, "i"))?.[1] ??
      attrs.match(new RegExp(`${n}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ??
      "";
    const label = m[2].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (label) out.push({ value: pick("value"), title: pick("title"), label });
  }
  return out;
}

/** The "-Select-" / "Select" entry is a placeholder, not a real choice. */
const isPlaceholder = (o) => o.value === "0" || /^-?\s*select\s*-?$/i.test(o.label);
const realOptions = (list) => (list ?? []).filter((o) => !isPlaceholder(o));

/** Strip tags and collapse whitespace, for table scraping. */
function cellText(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Pull the roster out of the register table.
 *
 * The last two columns are always attended/held and the percentage, and the
 * roll number sits in column two. Percentages that will not parse are kept as
 * null rather than dropped, so a student is never silently missing from a
 * count just because one cell was odd.
 */
function parseRegister(html) {
  let table = null;
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const head = cellText((t.match(/<tr[\s\S]*?<\/tr>/i) ?? [""])[0]);
    if (/roll\s*\.?\s*no/i.test(head)) { table = t; break; }
  }
  if (!table) return [];

  const rows = [];
  for (const tr of (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).slice(1)) {
    const cells = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cellText(m[1]));
    if (cells.length < 4) continue;
    const roll = cells[1];
    if (!roll) continue;
    const held = cells[cells.length - 2] ?? "";
    const pct = cells[cells.length - 1] ?? "";
    const num = parseFloat(String(pct).replace("%", ""));
    rows.push({
      sl: cells[0] ?? "",
      roll,
      name: cells[2] ?? "",
      held,
      pct: Number.isNaN(num) ? null : num,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ sessions */

const sessions = new Map();

function reapSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.at > SESSION_TTL_MS) sessions.delete(id);
  }
}

function getSession(id) {
  if (!id) return null;
  reapSessions();
  const s = sessions.get(id);
  if (!s) return null;
  s.at = Date.now();
  return s;
}

function readCookie(req, name) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function requireSession(req) {
  const s = getSession(readCookie(req, "ecap_sid"));
  if (!s) throw new HttpError(401, "Your session expired. Please sign in again.");
  if (!s.portal.signedIn) {
    sessions.delete(readCookie(req, "ecap_sid"));
    throw new HttpError(401, "Your ECAP session expired. Please sign in again.");
  }
  return s;
}

/**
 * Labels for every level, cached per session.
 *
 * ShowAcademicCalendar needs each selection's visible text as well as its
 * value, but the browser only ever sends values, so the mapping is remembered
 * here as the dropdowns are filled.
 */
function remember(session, level, list) {
  session.labels[level] = Object.fromEntries(list.map((o) => [String(o.value), o]));
  return list;
}

function lookup(session, level, value) {
  if (value == null || value === "") return null;
  return session.labels[level]?.[String(value)] ?? null;
}

/* ------------------------------------------------------------------ http */

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
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
        const { userId, password } = await req.json().catch(() => ({}));
        if (!userId || !password) throw new HttpError(400, "Enter your user name and password.");

        reapSessions();
        const portal = new Portal();
        try {
          await portal.signIn(String(userId), String(password));
        } catch (e) {
          // Nothing to salvage from a failed attempt, so drop the jar entirely.
          throw e instanceof HttpError ? e : new HttpError(502, e.message);
        }

        const id = crypto.randomUUID();
        sessions.set(id, { at: Date.now(), portal, labels: {} });
        return json(
          { ok: true },
          200,
          { "set-cookie": `ecap_sid=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}` },
        );
      }

      if (req.method === "POST" && path === "/api/logout") {
        sessions.delete(readCookie(req, "ecap_sid"));
        return json({ ok: true }, 200, { "set-cookie": "ecap_sid=; Path=/; Max-Age=0" });
      }

      /* ---- everything below needs a signed-in session ---- */
      if (path.startsWith("/api/")) {
        if (path === "/api/session") {
          // Probe the session but do not require the portal cookie, so a stale
          // page can tell the difference between "not signed in" and "expired".
          const s = getSession(readCookie(req, "ecap_sid"));
          if (!s) return json({ signedIn: false }, 200);
          return json({ signedIn: s.portal.signedIn }, 200);
        }

        const s = requireSession(req);
        const portal = s.portal;

        /**
         * The whole selection is sent each time; only the levels that are now
         * derivable get filled, and deeper ones come back empty so the front
         * end can disable them.
         */
        if (req.method === "POST" && path === "/api/options") {
          const b = await req.json().catch(() => ({}));
          const out = { course: [], semester: [], branch: [], section: [], subject: [] };

          out.course = remember(s, "course", realOptions(await portal.courses()));

          if (b.course) {
            const [branches, semesters] = await portal.branchesAndSemesters(b.course);
            out.branch = remember(s, "branch", realOptions(branches));
            out.semester = remember(s, "semester", realOptions(semesters));
          }
          if (b.course && b.branch && b.semester) {
            const semester = lookup(s, "semester", b.semester);
            out.section = remember(s, "section", realOptions(await portal.sections(b.course, b.branch, semester)));
          }
          if (b.course && b.branch && b.semester && b.section) {
            out.subject = remember(s, "subject", realOptions(await portal.subjects(b.course, b.branch, b.semester)));
          }
          return json(out);
        }

        if (req.method === "POST" && path === "/api/register") {
          const b = await req.json();
          if (!b.course) throw new HttpError(400, "Choose a course.");
          if (!b.semester) throw new HttpError(400, "Choose a semester.");
          if (!b.branch) throw new HttpError(400, "Choose a branch.");
          if (!b.section) throw new HttpError(400, "Choose a section.");
          if (!b.subject) throw new HttpError(400, "Choose a subject.");
          if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");

          // Every level is needed as both a value and its visible label.
          const p = {
            course: lookup(s, "course", b.course),
            branch: lookup(s, "branch", b.branch),
            semester: lookup(s, "semester", b.semester),
            section: lookup(s, "section", b.section),
            subject: lookup(s, "subject", b.subject),
          };
          const missing = Object.entries(p).filter(([, v]) => !v).map(([k]) => k);
          if (missing.length) {
            throw new HttpError(
              400,
              `Pick ${missing.join(", ")} again - the list of choices was refreshed.`,
            );
          }

          const rows = parseRegister(await portal.register({ ...p, from: b.from, to: b.to }));
          if (!rows.length) {
            throw new HttpError(
              502,
              "The register came back empty. Check that the subject has classes in that date range.",
            );
          }

          const withFlags = rows.map((r) => ({
            ...r,
            irregular: r.pct != null && r.pct < IRREGULAR_BELOW,
            critical: r.pct != null && r.pct < CRITICAL_BELOW,
          }));
          const counted = withFlags.filter((r) => r.pct != null);
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
              overCap: total > CLASS_CAP,
              overCapBy: Math.max(0, total - CLASS_CAP),
              average: counted.length
                ? Math.round((counted.reduce((a, r) => a + r.pct, 0) / counted.length) * 10) / 10
                : null,
              range: { from: b.from, to: b.to },
            },
          });
        }

        return json({ error: "Not found" }, 404);
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[error]", e.message);
      return json({ error: e.message || "Something went wrong." }, status);
    }
  },
});

console.log(`\n  ECAP Attendance Dashboard`);
console.log(`  http://127.0.0.1:${server.port}\n`);
console.log(`  Talking to ECAP over HTTPS directly - no browser is launched.`);
console.log(`  Your password is used once to sign in and is never stored.\n`);
