import {
  calendarPairs,
  classPairs,
  CookieJar,
  portalEncrypt,
  studentPairs,
} from "./portal-conventions.js";
import { liveness } from "./portal-liveness.js";
import type { CourseReader } from "./portal-liveness.js";
import {
  hiddenValue,
  HttpError,
  options,
  parseFacultyName,
  parseLeaveStatus,
} from "./portal-replies.js";
import {
  BASE,
  CLASS_REMOTE,
  HTTP_TIMEOUT_MS,
  LEAVE_STATUS_REMOTE,
  LOGIN_PAGE,
  LOGIN_POST,
  MAIN_DESIGNATION_REMOTE,
  MAIN_PHOTO_REMOTE,
  portalJq,
  portalRequest,
  portalWebMethod,
  PROFILE_REMOTE,
  REGISTER_PAGE_URL,
  REGISTER_REMOTE,
  UA,
} from "./portal-transport.js";
import {
  handleFacultyProfile,
  handleOptions,
  handleRegister,
  handleSemAbsences,
  handleSemStart,
  handleStudentProfile,
} from "./server-routes.js";
import type { PortalReader } from "./server-routes.js";
import type {
  CascadeLevel,
  ClientSession,
  ErrorReply,
  FacultyProfile,
  LoginRequest,
  OkReply,
  Option,
  OptionsRequest,
  RegisterRequest,
  SemAbsencesRequest,
  SessionReply,
  StudentRequest,
} from "./shared/api.js";
import { SESSION_HEADER } from "./shared/api.js";

type Level = CascadeLevel;
/** Thirty days of *not using it*, after ADR 0013. The browser carries `at`
 *  and the server slides it on every answer. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
class Portal {
  readonly jar = new CookieJar();
  get signedIn(): boolean {
    return this.jar.signedIn;
  }
  async signIn(userId: string, password: string): Promise<void> {
    const page = await fetch(LOGIN_PAGE, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const html = await page.text();
    const cipher = portalEncrypt(password);
    const res = await portalRequest(this.jar, LOGIN_POST, {
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
  async courses(): Promise<Option[]> {
    return options(
      await portalJq(this.jar, REGISTER_PAGE_URL, "LoadCourses", {
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
    const d = await portalJq(
      this.jar,
      REGISTER_PAGE_URL,
      "LoadBranchAndSemestersDropDown",
      {
        courseid: Number(courseId),
        branchcontrolid: "ddlbranch",
        branchonchangemethod: "",
        branchdefaultall: false,
        semestercontrolid: "ddlsemester",
        semesteronchangemethod: "",
        semesterdefaultall: false,
        semesterorbatch: "S",
      }
    );
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
      await portalJq(this.jar, REGISTER_PAGE_URL, "LoadBranchSections", {
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
      await portalWebMethod(this.jar, REGISTER_REMOTE, "FillSubjects", [
        ["CourseId", courseId],
        ["BranchId", branchId],
        ["SemesterId", semesterId],
      ])
    );
  }
  register(
    p: Record<Level, Option> & { from: string; to: string }
  ): Promise<string> {
    return portalWebMethod(
      this.jar,
      REGISTER_REMOTE,
      "ShowAcademicCalendar",
      calendarPairs(p)
    );
  }
  classAttendance(
    p: Record<Level, Option> & { from: string; to: string }
  ): Promise<string> {
    return portalWebMethod(
      this.jar,
      CLASS_REMOTE,
      "ShowAllAttendance",
      classPairs(p)
    );
  }
  /** The register page is this method's referer because that is the referer the
   *  Portal accepted it from when it was proved against a live session — the
   *  StudentProfile page itself was never tried, so there is no reason to move. */
  studentProfile(roll: string): Promise<string> {
    return portalWebMethod(this.jar, PROFILE_REMOTE, "ShowStudentProfileNew", [
      ["RollNo", roll],
      ["isImageDisplay", "true"],
    ]);
  }
  /** ECAP's main.aspx states the faculty member's name in the `lblUser` span and
   *  offers a photo path and a designation code through its proxy. None of it is
   *  structured, so each piece is read and combined here. */
  async facultyProfile(): Promise<FacultyProfile> {
    const page = await portalRequest(this.jar, LOGIN_PAGE, {
      method: "GET",
      headers: { "user-agent": UA, referer: LOGIN_PAGE },
    });
    const html = await page.text();
    const name = parseFacultyName(html);
    const photo = await portalWebMethod(
      this.jar,
      MAIN_PHOTO_REMOTE,
      "GetPhotoPath",
      []
    ).catch(() => "");
    const designation = await portalWebMethod(
      this.jar,
      MAIN_DESIGNATION_REMOTE,
      "CheckEmployeeDesignation",
      []
    ).catch(() => "-1");
    // A status grid ECAP will not give is no leave figures, not a failed
    // profile: the name and photo are still the answer the page came for.
    const leaveStatus = await portalWebMethod(
      this.jar,
      LEAVE_STATUS_REMOTE,
      "showLeaves",
      []
    )
      .then(parseLeaveStatus)
      .catch(() => []);
    return {
      name,
      photo: photo.trim(),
      designation: designation.trim(),
      leaveStatus,
    };
  }
  /** The Student Wise report: one student's grid, every subject, one column per
   *  day the section met. It lives on the register's own proxy and wants the
   *  same `no` session marker as the register it sits beside. */
  studentWise(
    roll: string,
    name: string,
    p: Record<Level, Option> & { from: string; to: string }
  ): Promise<string> {
    return portalWebMethod(
      this.jar,
      REGISTER_REMOTE,
      "ShowAcademicCalendar_StudentWise",
      studentPairs(roll, name, p)
    );
  }
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
 * Everything a signed-in call needs from ECAP: the jar the request's session
 * is rebuilt into, the liveness question, and the reader the route handlers
 * cross.
 */
export type PortalPort = CourseReader & {
  readonly jar: CookieJar;
  readonly signedIn: boolean;
  readonly reader: PortalReader;
  signIn: (userId: string, password: string) => Promise<void>;
};
type Session = {
  userId: string;
  // Kept so a dead ECAP session can be re-established without asking again.
  // It arrives with the request and leaves with the answer — see ADR 0024.
  password: string;
  portal: PortalPort;
};
export type ApiOptions = {
  /** How to reach ECAP. `Portal` is the real one; a test passes a fake. */
  connect?: () => PortalPort;
};
/**
 * The API over one way of reaching ECAP, kept as an argument rather than
 * module state so `test/api.spec.ts` drives the retry rules through
 * `handleApi` without touching ECAP.
 *
 * The server keeps no sessions of its own: the browser stores its session in
 * localStorage and sends it on every request, and every answer carries the
 * slid session back. Any instance — one long-running process or a fleet of
 * serverless functions — answers any request from the request alone.
 */
const encodeSession = (s: Session): string =>
  Buffer.from(
    JSON.stringify({
      userId: s.userId,
      password: s.password,
      cookies: [...s.portal.jar.entries],
      at: Date.now(),
    } satisfies ClientSession),
    "utf-8"
  ).toString("base64url");
/** The one signed-out reply, so the places that say it cannot drift apart. */
function signedOutReply(): SessionReply {
  return { signedIn: false, userId: "" };
}
/** The answer's slid session, or nothing on a request that refused. */
const sessionHeader = (s: Session): Record<string, string> => ({
  [SESSION_HEADER]: encodeSession(s),
});
export function createApi({ connect = () => new Portal() }: ApiOptions = {}) {
  /** The request's session, rebuilt into a portal. Null when there is nothing
   *  to rebuild from: no header, an unreadable one, or a shape that is not a
   *  session at all. Never throws. */
  function readSession(req: Request): Session | null {
    const raw = req.headers.get(SESSION_HEADER);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, "base64url").toString("utf-8")
      ) as Partial<ClientSession>;
      if (!parsed || typeof parsed.userId !== "string" || !parsed.userId)
        return null;
      if (
        typeof parsed.at !== "number" ||
        Date.now() - parsed.at > SESSION_TTL_MS
      )
        return null;
      if (
        !Array.isArray(parsed.cookies) ||
        parsed.cookies.some(
          (pair) =>
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            typeof pair[0] !== "string" ||
            typeof pair[1] !== "string"
        )
      )
        return null;
      const portal = connect();
      for (const [name, value] of parsed.cookies as [string, string][])
        portal.jar.entries.set(name, value);
      // A session stored before the credential existed carries none: it can
      // still be probed, it just cannot be revived.
      const password =
        typeof parsed.password === "string" ? parsed.password : "";
      return { userId: parsed.userId, password, portal };
    } catch {
      return null;
    }
  }
  function requireSession(req: Request): Session {
    const s = readSession(req);
    if (!s || !s.portal.signedIn)
      throw new HttpError(401, "Your session expired. Please sign in again.");
    return s;
  }
  /**
   * Re-establishes the portal session from the request's credential after ECAP
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
        const portal = connect();
        try {
          await portal.signIn(String(userId), String(password));
        } catch (error) {
          throw error instanceof HttpError
            ? error
            : new HttpError(502, messageOf(error));
        }
        const s: Session = {
          userId: String(userId).trim(),
          password: String(password),
          portal,
        };
        return json({ ok: true } satisfies OkReply, 200, sessionHeader(s));
      }
      if (req.method === "POST" && path === "/api/logout") {
        // Nothing server-side to end: the browser drops its stored session.
        return json({ ok: true } satisfies OkReply);
      }
      if (path === "/api/session") {
        const s = readSession(req);
        if (!s) return json(signedOutReply(), 200);
        if ((await liveness(s.portal)) === "dead") {
          const failure: unknown = await reauthenticate(s).catch(
            (error: unknown) => error
          );
          // Only a 401 says the credential is dead; a 502 is `unknown`, and
          // ADR 0019 forbids evicting on ambiguity. The next request asks again.
          // Either way there is nothing server-side to evict: the browser
          // drops a refused session itself.
          if (failure instanceof HttpError && failure.status === 401) {
            return json(signedOutReply(), 200);
          }
        }
        return json(
          {
            signedIn: s.portal.signedIn,
            userId: s.userId,
          } satisfies SessionReply,
          200,
          sessionHeader(s)
        );
      }
      const s = await requireSession(req);
      if (req.method === "POST" && path === "/api/options") {
        const body = await readJson<OptionsRequest>(req);
        return json(
          await withPortal(s, (p) => handleOptions(p.reader, body)),
          200,
          sessionHeader(s)
        );
      }
      if (req.method === "POST" && path === "/api/register") {
        const body = await readJson<RegisterRequest>(req);
        return json(
          await withPortal(s, (p) => handleRegister(p.reader, body)),
          200,
          sessionHeader(s)
        );
      }
      if (req.method === "POST" && path === "/api/sem-start") {
        const body = await readJson<RegisterRequest>(req);
        return json(
          await withPortal(s, (p) => handleSemStart(p.reader, body)),
          200,
          sessionHeader(s)
        );
      }
      if (req.method === "POST" && path === "/api/student") {
        const body = await readJson<StudentRequest>(req);
        return json(
          await withPortal(s, (p) => handleStudentProfile(p.reader, body)),
          200,
          sessionHeader(s)
        );
      }
      if (req.method === "POST" && path === "/api/faculty-profile") {
        return json(
          await withPortal(s, (p) => handleFacultyProfile(p.reader)),
          200,
          sessionHeader(s)
        );
      }
      if (req.method === "POST" && path === "/api/sem-absences") {
        const body = await readJson<SemAbsencesRequest>(req);
        return json(
          await withPortal(s, (p) => handleSemAbsences(p.reader, body)),
          200,
          sessionHeader(s)
        );
      }
      return json({ error: "Not found" } satisfies ErrorReply, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error("[error]", messageOf(error));
      // A refusal carries no session header, so the browser drops what it
      // holds. There is nothing server-side to evict: a 401 from signing in
      // is about the password just typed, and any other 401 is about the
      // session the request carried.
      return json(
        { error: messageOf(error) || "Something went wrong." },
        status
      );
    }
  }
  return { handleApi };
}
