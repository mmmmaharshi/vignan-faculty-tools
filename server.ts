import {
  absorbResponse,
  calendarPairs,
  classPairs,
  CookieJar,
  jqBody,
  nextHop,
  portalEncrypt,
  webMethodBody,
} from "./portal-conventions";
import { liveness } from "./portal-liveness";
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

type Level = CascadeLevel;
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
const CLASS_PAGE_URL = `${BASE}/vignanit/ACADEMICS/rptstudentsattendance.aspx?scrid=319`;
const CLASS_PROXY = `${BASE}/vignanit/ajax/Academics_rptstudentsattendance,App_Web_rptstudentsattendance.aspx.a2a1b31c.ashx`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 60_000;
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
class Portal {
  readonly jar = new CookieJar();
  get signedIn(): boolean {
    return this.jar.signedIn;
  }
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
  async #webMethod(
    remote: { proxy: string; referer: string },
    name: string,
    pairs: [string, string | number][]
  ): Promise<string> {
    const res = await this.#request(
      `${remote.proxy}?_method=${name}&_session=no`,
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
  async courses(): Promise<Option[]> {
    return options(
      await this.#jq("LoadCourses", {
        controlid: "ddlcourse",
        onchangemethod: "",
        isdefaultall: false,
      })
    );
  }
  get reader(): PortalReader {
    return this;
  }
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
      await this.#webMethod(
        { proxy: REGISTER_PROXY, referer: REGISTER_PAGE_URL },
        "FillSubjects",
        [
          ["CourseId", courseId],
          ["BranchId", branchId],
          ["SemesterId", semesterId],
        ]
      )
    );
  }
  register(
    p: Record<Level, Option> & { from: string; to: string }
  ): Promise<string> {
    return this.#webMethod(
      { proxy: REGISTER_PROXY, referer: REGISTER_PAGE_URL },
      "ShowAcademicCalendar",
      calendarPairs(p)
    );
  }
  classAttendance(
    p: Record<Level, Option> & { from: string; to: string }
  ): Promise<string> {
    return this.#webMethod(
      { proxy: CLASS_PROXY, referer: CLASS_PAGE_URL },
      "ShowAllAttendance",
      classPairs(p)
    );
  }
}
type Session = {
  at: number;
  portal: Portal;
};
const sessions = new Map<string, Session>();
const SESSION_FLUSH_MS = 60_000;
const vault = bunSecrets();
let storeDirty = false;
function markStoreDirty() {
  storeDirty = true;
}
function dropSession(id: string | null): boolean {
  if (!id) return false;
  const removed = sessions.delete(id);
  if (removed) markStoreDirty();
  return removed;
}
function refreshedCookie(id: string): Record<string, string> {
  return {
    "set-cookie": `ecap_sid=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
  };
}
function snapshotSessions(): StoredSession[] {
  return [...sessions].map(([id, s]) => ({
    id,
    at: s.at,
    cookies: [...s.portal.jar.entries],
  }));
}
async function flushSessions(): Promise<void> {
  if (!vault || !storeDirty) return;
  const problem = await saveSessions(vault, snapshotSessions());
  if (problem) {
    console.error(`[sessions] ${problem}`);
    return;
  }
  storeDirty = false;
}
async function forgetSession(id: string | null): Promise<void> {
  if (dropSession(id)) await flushSessions();
}
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
/** Restores every session still inside the TTL, then answers whether a vault exists. */
async function restoreSessions(): Promise<boolean> {
  if (!vault) return false;
  const loaded = await loadSessions(vault);
  const { kept, dropped } = sweep(loaded, Date.now(), SESSION_TTL_MS);
  for (const stored of kept) {
    if (sessions.has(stored.id)) continue;
    sessions.set(stored.id, restoreSession(stored));
  }
  if (dropped) markStoreDirty();
  return true;
}
function getSession(id: string | null): Session | null {
  if (!id) return null;
  reapSessions();
  const s = sessions.get(id);
  if (!s) return null;
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
async function requireSession(req: Request): Promise<Session> {
  const id = readCookie(req, "ecap_sid");
  const s = getSession(id);
  if (!s)
    throw new HttpError(401, "Your session expired. Please sign in again.");
  if (!s.portal.signedIn) {
    await forgetSession(id);
    throw new HttpError(
      401,
      "Your ECAP session expired. Please sign in again."
    );
  }
  return s;
}
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
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}
const vaultBacked = await restoreSessions();
setInterval(async () => {
  await flushSessions();
}, SESSION_FLUSH_MS);
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
      if (req.method === "POST" && path === "/api/login") {
        const { userId, password } = await readJson<LoginRequest>(req);
        if (!userId || !password)
          throw new HttpError(400, "Enter your user name and password.");
        reapSessions();
        const portal = new Portal();
        try {
          await portal.signIn(String(userId), String(password));
        } catch (error) {
          throw error instanceof HttpError
            ? error
            : new HttpError(502, messageOf(error));
        }
        const id = crypto.randomUUID();
        sessions.set(id, { at: Date.now(), portal });
        markStoreDirty();
        await flushSessions();
        return json({ ok: true } satisfies OkReply, 200, refreshedCookie(id));
      }
      if (req.method === "POST" && path === "/api/logout") {
        const id = readCookie(req, "ecap_sid");
        await forgetSession(id);
        return json({ ok: true } satisfies OkReply, 200, {
          "set-cookie": "ecap_sid=; Path=/; Max-Age=0",
        });
      }
      if (path.startsWith("/api/")) {
        if (path === "/api/session") {
          const id = readCookie(req, "ecap_sid");
          const s = getSession(id);
          if (!s)
            return json(
              {
                signedIn: false,
                persisted: Boolean(vault),
              } satisfies SessionReply,
              200
            );
          if ((await liveness(s.portal)) === "dead") {
            await forgetSession(id);
            return json(
              {
                signedIn: false,
                persisted: Boolean(vault),
              } satisfies SessionReply,
              200
            );
          }
          return json(
            {
              signedIn: s.portal.signedIn,
              persisted: Boolean(vault),
            } satisfies SessionReply,
            200,
            id ? refreshedCookie(id) : undefined
          );
        }
        const s = await requireSession(req);
        const { portal } = s;
        const id = readCookie(req, "ecap_sid");
        const cookie = id ? refreshedCookie(id) : undefined;
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
console.log(`\n  Vignan Faculty Tools`);
console.log(`  http://127.0.0.1:${server.port}\n`);
if (!vaultBacked)
  console.log(
    `  No OS credential vault on this runtime, so a restart signs you out.\n`
  );
