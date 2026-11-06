import type {
  CascadeLevel,
  ClientSession,
  ErrorReply,
  FacultyProfile,
  FindRequest,
  LeaveStatus,
  LoginRequest,
  OkReply,
  Option,
  OptionsRequest,
  RegisterRequest,
  SemAbsencesRequest,
  SessionReply,
  SemStartRequest,
  StudentRequest,
} from "../shared/api.js";
import { messageOf, SESSION_HEADER } from "../shared/api.js";
import { HttpError, sessionExpired } from "./http-error.js";
import {
  calendarPairs,
  classPairs,
  CookieJar,
  dayWorkPairs,
  portalEncrypt,
  studentPairs,
  subjectReportPairs,
} from "./portal-conventions.js";
import type { DayWorkRequest } from "./portal-conventions.js";
import { parseFacultyName, parseLeaveStatus } from "./portal-faculty.js";
import { hiddenValue } from "./portal-html.js";
import { courseVerdict } from "./portal-liveness.js";
import type { CourseReader } from "./portal-liveness.js";
import { options } from "./portal-options.js";
import type { PortalReader } from "./portal-reader.js";
import {
  BASE,
  CLASS_REMOTE,
  DASHBOARD_REMOTE,
  DAYWORK_REMOTE,
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
  SUBJECT_ATTENDANCE_REMOTE,
  UA,
} from "./portal-transport.js";
import {
  handleFacultyProfile,
  handleFind,
  handleOptions,
  handleRegister,
  handleSemAbsences,
  handleSemStart,
  handleStudentProfile,
  handleTodayClasses,
  handleUnposted,
} from "./server-routes.js";
import { sessionVerdict } from "./session-verdict.js";

type Level = CascadeLevel;
/** Thirty days of *not using it*, after ADR 0013. The browser carries `at`
 *  and the server slides it on every answer. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
  /** The subjects the SUBJECT ATTENDANCE page offers for one class — the only
   *  subject ids ShowSubjectAttendance accepts, read from the same page. */
  async subjectOptions(
    courseId: string | number,
    branchId: string | number,
    semesterId: string | number
  ): Promise<Option[]> {
    return options(
      await portalWebMethod(
        this.jar,
        SUBJECT_ATTENDANCE_REMOTE,
        "FillSubjects",
        [
          ["CourseId", courseId],
          ["BranchId", branchId],
          ["SemesterId", semesterId],
        ]
      )
    );
  }
  /** One subject's attendance report: every student in the section with that
   *  subject's stated attended count and percent. Proved live 2026-11-02. */
  subjectReport(
    p: Record<Level, Option> & { from: string; to: string },
    subject: Option
  ): Promise<string> {
    return portalWebMethod(
      this.jar,
      SUBJECT_ATTENDANCE_REMOTE,
      "ShowSubjectAttendance",
      subjectReportPairs(p, subject)
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
   *  structured, so each piece is read and combined here. The three follow-up
   *  reads are independent of each other — and of the name — so they go out
   *  together rather than one after another. */
  async facultyProfile(): Promise<FacultyProfile> {
    const page = await portalRequest(this.jar, LOGIN_PAGE, {
      method: "GET",
      headers: { "user-agent": UA, referer: LOGIN_PAGE },
    });
    const html = await page.text();
    const name = parseFacultyName(html);
    // Each answer carries its own fallback: a grid ECAP will not give is no
    // leave figures, not a failed profile, and the same holds for the photo
    // and the designation.
    const [photo, designation, leaveStatus] = await Promise.all([
      portalWebMethod(this.jar, MAIN_PHOTO_REMOTE, "GetPhotoPath", []).catch(
        () => ""
      ),
      portalWebMethod(
        this.jar,
        MAIN_DESIGNATION_REMOTE,
        "CheckEmployeeDesignation",
        []
      ).catch(() => "-1"),
      portalWebMethod(this.jar, LEAVE_STATUS_REMOTE, "showLeaves", [])
        .then(parseLeaveStatus)
        .catch((): LeaveStatus[] => []),
    ]);
    return {
      name,
      photo: photo.trim(),
      designation: designation.trim(),
      leaveStatus,
    };
  }
  /** Today's timetable: the dashboard's own schedule grid, through the page's
   *  own GetToDayClasses call. The page passes no parameters, so neither does
   *  this. */
  todayClasses(): Promise<string> {
    return portalWebMethod(this.jar, DASHBOARD_REMOTE, "GetToDayClasses", []);
  }
  /** The day-class-work report for one branch and date: every held period
   *  with its posted counts, through the report's own ShowDayClassWork call
   *  with the page's own array shapes. */
  dayClassWork(p: DayWorkRequest): Promise<string> {
    return portalWebMethod(
      this.jar,
      DAYWORK_REMOTE,
      "ShowDayClassWork",
      dayWorkPairs(p)
    );
  }
  /** The Cumulative student-wise register: the same twelve values, same order,
   *  on the register's own proxy — the screen a faculty reaches with Student-
   *  wise + Cumulative. Its reply carries the day grid whose marks the totals
   *  are counted from. */
  studentCumulative(
    roll: string,
    name: string,
    p: Record<Level, Option> & { from: string; to: string }
  ): Promise<string> {
    return portalWebMethod(
      this.jar,
      REGISTER_REMOTE,
      "ShowAcademicCalendar_StudentWise_Cumulative",
      studentPairs(roll, name, p)
    );
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
 * Every signed-in read the API answers: the path, and how to turn a request into
 * the work to do once a portal is in hand. One table, so a new endpoint is one
 * row here rather than a sixth copy of parse-then-answer, and the `withRevival`
 * and session-header rules cannot be forgotten on it.
 *
 * The body is read here, once, before any revival: a `Request` body can only be
 * read once, and `withRevival` runs the work again on a fresh portal.
 */
type Work = (portal: PortalReader) => Promise<unknown>;
type Read = (req: Request) => Work | Promise<Work>;
const READS: Record<string, Read> = {
  "/api/options": async (req) => {
    const body = await readJson<OptionsRequest>(req);
    return (p) => handleOptions(p, body);
  },
  "/api/register": async (req) => {
    const body = await readJson<RegisterRequest>(req);
    return (p) => handleRegister(p, body);
  },
  "/api/sem-start": async (req) => {
    const body = await readJson<SemStartRequest>(req);
    return (p) => handleSemStart(p, body);
  },
  "/api/student": async (req) => {
    const body = await readJson<StudentRequest>(req);
    return (p) => handleStudentProfile(p, body);
  },
  "/api/find": async (req) => {
    const body = await readJson<FindRequest>(req);
    return (p) => handleFind(p, body);
  },
  "/api/sem-absences": async (req) => {
    const body = await readJson<SemAbsencesRequest>(req);
    return (p) => handleSemAbsences(p, body);
  },
  "/api/faculty-profile": () => (p) => handleFacultyProfile(p),
  "/api/today": () => (p) => handleTodayClasses(p),
  "/api/unposted": () => (p) => handleUnposted(p),
};
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
type ApiOptions = {
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
    if (!s || !s.portal.signedIn) throw sessionExpired();
    return s;
  }
  /**
   * Re-establishes the portal session from the request's credential after ECAP
   * drops it. Throws 401 when there is no credential or the password no longer
   * works.
   */
  async function reauthenticate(s: Session): Promise<void> {
    if (!s.password) throw sessionExpired();
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
   * Every data read over a connection ECAP may have dropped: a 401 or a
   * 502 signs in again once and retries the same read on the fresh portal.
   * A second failure signs out or answers as-is instead of buying another
   * revival. One revival per failure, failure-path only, and it never
   * signs anyone out on ambiguity.
   */
  async function withRevival<T>(
    s: Session,
    run: (portal: PortalPort) => Promise<T>
  ): Promise<T> {
    try {
      return await run(s.portal);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      if (error.status !== 401 && error.status !== 502) throw error;
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
        // One decision, not nested ifs: only a 401 evicts, a 502 stays
        // `unknown` (ADR 0019). Either way nothing is evicted server-side.
        const verdictOfPortal = await courseVerdict(s.portal);
        const probe = verdictOfPortal.verdict;
        const failure: unknown =
          probe === "dead"
            ? await reauthenticate(s).catch((error: unknown) => error)
            : null;
        const verdict = sessionVerdict(
          probe,
          failure instanceof HttpError ? failure : null
        );
        if (verdict === "dead") return json(signedOutReply(), 200);
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
      const read = req.method === "POST" ? READS[path] : undefined;
      if (read) {
        const work = await read(req);
        return json(
          await withRevival(s, (p) => work(p.reader)),
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
