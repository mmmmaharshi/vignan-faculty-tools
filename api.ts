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
import type { CourseReader } from "./portal-liveness";
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
import type { Secrets, StoredSession } from "./session-store";
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
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const FLUSH_INTERVAL_MS = 60_000;
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
function refreshedCookie(id: string): Record<string, string> {
  return {
    "set-cookie": `ecap_sid=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`,
  };
}
function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
export function json(
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
/**
 * Everything a signed-in call needs from ECAP: the jar the session is persisted
 * from, the liveness question, and the reader the route handlers cross.
 */
export type PortalPort = CourseReader & {
  readonly jar: CookieJar;
  readonly signedIn: boolean;
  readonly reader: PortalReader;
  signIn: (userId: string, password: string) => Promise<void>;
};
type Session = {
  at: number;
  userId: string;
  // Kept so a dead ECAP session can be re-established without asking again. It
  // lives only in the OS vault. See ADR 0019.
  password: string;
  portal: PortalPort;
};
export type ApiOptions = {
  /** Where sessions are kept. `bunSecrets()` is the real one; a test passes a fake. */
  vault?: Secrets | null;
  /** How to reach ECAP. `Portal` is the real one; a test passes a fake. */
  connect?: () => PortalPort;
};
/**
 * One process's sessions, over one vault and one way of reaching ECAP. Both are
 * arguments rather than module state, which is what lets `test/api.spec.ts`
 * drive the retry rules through `handleApi` without a credential vault.
 */
export function createApi({
  vault = bunSecrets(),
  connect = () => new Portal(),
}: ApiOptions = {}) {
  const sessions = new Map<string, Session>();
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
  function snapshotSessions(): StoredSession[] {
    return [...sessions].map(([id, s]) => ({
      id,
      at: s.at,
      userId: s.userId,
      password: s.password,
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
    const portal = connect();
    for (const [name, value] of stored.cookies)
      portal.jar.entries.set(name, value);
    return {
      at: stored.at,
      userId: stored.userId,
      password: stored.password ?? "",
      portal,
    };
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
  /**
   * The session lifecycle both servers need: restore before serving, then keep
   * the slid `at` written back. `server.ts` does this inline so it can also
   * flush on exit; the dev plugin calls this.
   */
  async function startSessions(): Promise<void> {
    await restoreSessions();
    setInterval(async () => {
      await flushSessions();
    }, FLUSH_INTERVAL_MS);
  }
  /** The one signed-out reply, so the places that say it cannot drift apart. */
  function signedOutReply(): SessionReply {
    return { signedIn: false, persisted: Boolean(vault), userId: "" };
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
  /**
   * Re-establishes the portal session from the stored credential after ECAP
   * drops it. Throws 401 when there is no credential or the password no longer
   * works.
   */
  async function reauthenticate(s: Session): Promise<void> {
    if (!s.password)
      throw new HttpError(
        401,
        "Your ECAP session expired. Please sign in again."
      );
    const portal = connect();
    try {
      await portal.signIn(s.userId, s.password);
    } catch (error) {
      throw error instanceof HttpError
        ? error
        : new HttpError(502, messageOf(error));
    }
    s.portal = portal;
    markStoreDirty();
    await flushSessions();
  }
  /**
   * Runs a portal operation, and if it 401s because ECAP dropped the session,
   * signs in again once and retries. A 502 stays `unknown` and is not retried.
   */
  async function withPortal<T>(
    s: Session,
    run: (portal: PortalPort) => Promise<T>
  ): Promise<T> {
    try {
      return await run(s.portal);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) throw error;
      await reauthenticate(s);
      return await run(s.portal);
    }
  }
  /** Answers every `/api/*` request. Shared by `server.ts` (prod) and the Vite dev plugin. */
  async function handleApi(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
      if (req.method === "POST" && path === "/api/login") {
        const { userId, password } = await readJson<LoginRequest>(req);
        if (!userId || !password)
          throw new HttpError(400, "Enter your user name and password.");
        reapSessions();
        const portal = connect();
        try {
          await portal.signIn(String(userId), String(password));
        } catch (error) {
          throw error instanceof HttpError
            ? error
            : new HttpError(502, messageOf(error));
        }
        const id = crypto.randomUUID();
        sessions.set(id, {
          at: Date.now(),
          userId: String(userId).trim(),
          password: String(password),
          portal,
        });
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
      if (path === "/api/session") {
        const id = readCookie(req, "ecap_sid");
        const s = getSession(id);
        if (!s) return json(signedOutReply(), 200);
        if ((await liveness(s.portal)) === "dead") {
          const failure: unknown = await reauthenticate(s).catch(
            (error: unknown) => error
          );
          // Only a 401 says the credential is dead; a 502 is `unknown`, and
          // ADR 0019 forbids evicting on ambiguity. The next request asks again.
          if (failure instanceof HttpError && failure.status === 401) {
            await forgetSession(id);
            return json(signedOutReply(), 200);
          }
        }
        return json(
          {
            signedIn: s.portal.signedIn,
            persisted: Boolean(vault),
            userId: s.userId,
          } satisfies SessionReply,
          200,
          id ? refreshedCookie(id) : undefined
        );
      }
      const s = await requireSession(req);
      const id = readCookie(req, "ecap_sid");
      const cookie = id ? refreshedCookie(id) : undefined;
      if (req.method === "POST" && path === "/api/options") {
        const body = await readJson<OptionsRequest>(req);
        return json(
          await withPortal(s, (p) => handleOptions(p.reader, body)),
          200,
          cookie
        );
      }
      if (req.method === "POST" && path === "/api/register") {
        const body = await readJson<RegisterRequest>(req);
        return json(
          await withPortal(s, (p) => handleRegister(p.reader, body)),
          200,
          cookie
        );
      }
      return json({ error: "Not found" } satisfies ErrorReply, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error("[error]", messageOf(error));
      // A 401 on the way out is a session ECAP has already rejected, so its
      // credential goes with it (ADR 0019). One raised by signing in is about
      // the password just typed, not the stored session, so it evicts nothing;
      // and an id that is not in the map is left alone, so nothing is written
      // back for a request that had none.
      if (status === 401 && path !== "/api/login") {
        const id = readCookie(req, "ecap_sid");
        if (id && sessions.has(id)) await forgetSession(id);
      }
      return json(
        { error: messageOf(error) || "Something went wrong." },
        status
      );
    }
  }
  return { flushSessions, restoreSessions, startSessions, handleApi };
}
