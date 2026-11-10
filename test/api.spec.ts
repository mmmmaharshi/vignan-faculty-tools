import { expect, test } from "@playwright/test";

import { createApi } from "../server/api";
import type { PortalPort } from "../server/api";
import { HttpError } from "../server/http-error";
import { CookieJar } from "../server/portal-conventions";
import type { PortalReader } from "../server/portal-reader";
import type {
  ClientSession,
  OptionsReply,
  RegisterRequest,
  SessionReply,
} from "../shared/api";
import { SESSION_HEADER } from "../shared/api";

type Api = ReturnType<typeof createApi>;
const opt = (value: string, label: string) => ({ value, label, title: "" });
const COURSE = opt("1", "B.Tech");
const SUBJECT = opt("9", "OS");
const REGISTER: RegisterRequest = {
  course: COURSE,
  semester: opt("3", "3-1"),
  branch: opt("4", "CSE"),
  section: opt("12", "Section-A"),
  subject: SUBJECT,
  from: "01/07/2026",
  to: "15/07/2026",
};
/** One day-class-work section block with the report's own geometry. */
const DAYWORK = `<b>Course:</b>&nbsp;B.Tech<div><b>Branch:</b>&nbsp;Information Technology</div><div><b>Semester:</b>&nbsp;III Semester</div><div><b>Section:</b>&nbsp;B</div>
<table><tr><td>Period</td><td>Subject</td><td>Name of the staff</td><td>Unit.No</td><td>Topics Covered</td><td>Present</td><td>Absent</td><td>Rolls</td></tr>
<tr><td>1</td><td>MFCS</td><td>Some One</td><td>-</td><td>-</td><td>30</td><td>5</td><td>21B</td></tr>
<tr><td>2</td><td>SE</td><td>Other Two</td><td>-</td><td>-</td><td></td><td></td><td></td></tr></table>`;
/** One register row with the grid's own geometry, and one class-report row. */
const ONE_ROW = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
<tr><td>1</td><td>21CS001</td><td>A Student</td><td>38/45</td><td>84.44</td></tr></table>`;
const ONE_CLASS_ROW = `<table>
    <tr><td>ATTENDANCE REPORT FOR THE PERIOD OF</td></tr>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>Total</th><th>Percent</th></tr>
    <tr><td>Batch-1</td><td>50</td><td>0</td><td>49</td><td></td><td></td></tr>
    <tr><td>1</td><td>21CS001</td><td>Name 1</td><td>37</td><td>381\\481</td><td>79.21</td></tr>
  </table>`;
/** A browser-stored session, as `/api/login` answers it. */
function stored(over: Partial<ClientSession> = {}): string {
  const full: ClientSession = {
    userId: "sirichandrasekhar",
    password: "hunter2",
    cookies: [["frmAuth", "ok"]],
    at: Date.now(),
    ...over,
  };
  return Buffer.from(JSON.stringify(full), "utf-8").toString("base64url");
}
function readerWith(over: Partial<PortalReader> = {}): PortalReader {
  return {
    courses: () => Promise.resolve([COURSE]),
    branchesAndSemesters: () => Promise.resolve([[], []]),
    sections: () => Promise.resolve([]),
    subjects: () => Promise.resolve([]),
    register: () => Promise.resolve(""),
    classAttendance: () => Promise.resolve(""),
    subjectOptions: () => Promise.resolve([]),
    subjectReport: () => Promise.resolve(""),
    studentProfile: () => Promise.resolve(""),
    studentWise: () => Promise.resolve(""),
    studentCumulative: () => Promise.resolve(""),
    todayClasses: () => Promise.resolve(""),
    dayClassWork: () => Promise.resolve(""),
    facultyProfile: () =>
      Promise.resolve({
        name: "Test Faculty",
        photo: "",
        designation: "0",
        leaveStatus: [],
      }),
    ...over,
  };
}
const expiredCourses = () => Promise.reject(new HttpError(401, "expired"));
/**
 * A portal over one reader, counting the revivals it was asked to perform.
 * `signInError` makes that sign-in fail, which is the only way to see what a
 * failed revival does to the session.
 */
function portalOf(
  reader: PortalReader,
  revivals: { count: number },
  signInError?: Error
): PortalPort {
  const jar = new CookieJar();
  jar.entries.set("frmAuth", "ok");
  return {
    ...reader,
    jar,
    signedIn: true,
    signIn: () => {
      revivals.count += 1;
      return signInError ? Promise.reject(signInError) : Promise.resolve();
    },
  };
}
function call(
  api: Api,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return api.handleApi(new Request(`http://127.0.0.1:8787${path}`, init));
}
function post(
  api: Api,
  path: string,
  body: unknown,
  session?: string
): Promise<Response> {
  return call(api, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { [SESSION_HEADER]: session } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function signIn(api: Api): Promise<string> {
  const res = await post(api, "/api/login", {
    userId: "sirichandrasekhar",
    password: "hunter2",
  });
  expect(res.status).toBe(200);
  return res.headers.get(SESSION_HEADER) ?? "";
}
test.describe("handleApi", () => {
  test("a 401 mid-request signs in again, and the original call is retried", async () => {
    const revivals = { count: 0 };
    const expired = readerWith({
      courses: () => Promise.reject(new HttpError(401, "expired")),
    });
    let built = 0;
    const api = createApi({
      // The request rebuilds its portal from the stored session, so both the
      // sign-in build and the request build see the expired reader; only the
      // revival builds fresh.
      connect: () => portalOf(built++ < 2 ? expired : readerWith(), revivals),
    });
    const session = await signIn(api);
    expect(session, "sign-in answers a session to store").not.toBe("");
    revivals.count = 0;
    const res = await post(api, "/api/options", { course: "1" }, session);
    expect(res.status).toBe(200);
    expect(((await res.json()) as OptionsReply).course[0]?.label).toBe(
      "B.Tech"
    );
    expect(revivals.count).toBe(1);
  });
  test("a second 401 is answered, never retried again", async () => {
    const revivals = { count: 0 };
    const expired = readerWith({
      courses: () => Promise.reject(new HttpError(401, "expired")),
    });
    const api = createApi({
      connect: () => portalOf(expired, revivals),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/options", { course: "1" }, session);
    expect(res.status).toBe(401);
    expect(revivals.count).toBe(1);
  });
  test("a 502 is retried once, and does not sign anyone out", async () => {
    const revivals = { count: 0 };
    const api = createApi({
      connect: () =>
        portalOf(
          readerWith({
            register: () =>
              Promise.reject(new HttpError(502, "ECAP rejected the report")),
          }),
          revivals
        ),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const failed = await post(api, "/api/register", REGISTER, session);
    expect(failed.status).toBe(502);
    expect(revivals.count).toBe(1);
    const after = await call(api, "/api/session", {
      headers: { [SESSION_HEADER]: session },
    });
    expect((await after.json()) as SessionReply).toMatchObject({
      signedIn: true,
    });
  });
  test("an unknown course verdict on unposted is retried once over a fresh sign-in", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    const good = readerWith({
      branchesAndSemesters: () =>
        Promise.resolve([
          [{ value: "6", label: "Information Technology", title: "IT" }],
          [{ value: "2", label: "III Semester", title: "2025" }],
        ]),
      dayClassWork: () => Promise.resolve(DAYWORK),
    });
    let built = 0;
    const api = createApi({
      // Login builds flaky (its sign-in succeeds regardless); the request's
      // own build is flaky too, and only the revival builds fresh.
      connect: () => portalOf(built++ < 2 ? flaky : good, revivals),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/unposted", {}, session);
    expect(res.status).toBe(200);
    expect(revivals.count).toBe(1);
  });
  test("a still-unknown verdict after the revival answers 502, never a third try", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    const api = createApi({ connect: () => portalOf(flaky, revivals) });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/unposted", {}, session);
    expect(res.status).toBe(502);
    expect(revivals.count).toBe(1);
  });
  test("a dead session behind the unknown answers 401 with no second revival", async () => {
    const revivals = { count: 0 };
    let coursesCalls = 0;
    const reader = readerWith({
      courses: () =>
        coursesCalls++ === 0
          ? Promise.reject(new HttpError(502, "proxy hiccup"))
          : Promise.reject(new HttpError(401, "expired")),
    });
    const api = createApi({ connect: () => portalOf(reader, revivals) });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/unposted", {}, session);
    expect(res.status).toBe(401);
    expect(revivals.count).toBe(1);
  });
  test("a 401 from the revival signs out at once, and answers nothing to store", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    let built = 0;
    const api = createApi({
      connect: () => {
        const n = built++;
        return portalOf(
          flaky,
          revivals,
          // The revival's own sign-in is refused: the credential is dead.
          n >= 2 ? new HttpError(401, "bad password") : undefined
        );
      },
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/unposted", {}, session);
    expect(res.status).toBe(401);
    expect(revivals.count).toBe(1);
    expect(res.headers.get(SESSION_HEADER)).toBe(null);
  });
  test("every data read shares the revival: today retries once when stale", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      todayClasses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    const good = readerWith({
      todayClasses: () => Promise.resolve("</table>"),
    });
    let built = 0;
    const api = createApi({
      connect: () => portalOf(built++ < 2 ? flaky : good, revivals),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/today", {}, session);
    expect(res.status).toBe(200);
    expect(revivals.count).toBe(1);
  });
  test("every data read shares the revival: faculty-profile retries once when stale", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      facultyProfile: () => Promise.reject(new HttpError(502, "proxy hiccup")),
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    let built = 0;
    const api = createApi({
      connect: () => portalOf(built++ < 2 ? flaky : readerWith(), revivals),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/faculty-profile", {}, session);
    expect(res.status).toBe(200);
    expect(revivals.count).toBe(1);
  });
  test("every data read shares the revival: options retries once when stale", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    let built = 0;
    const api = createApi({
      connect: () => portalOf(built++ < 2 ? flaky : readerWith(), revivals),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/options", { course: "1" }, session);
    expect(res.status).toBe(200);
    expect(((await res.json()) as OptionsReply).course[0]?.label).toBe(
      "B.Tech"
    );
    expect(revivals.count).toBe(1);
  });
  test("a stale-looking register 502 is retried once over a fresh sign-in", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      register: () => Promise.reject(new HttpError(502, "proxy hiccup")),
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    const good = readerWith({
      register: () => Promise.resolve(ONE_ROW),
      classAttendance: () => Promise.resolve(ONE_CLASS_ROW),
    });
    let built = 0;
    const api = createApi({
      // Login builds flaky (its sign-in succeeds regardless); the request's
      // own build is flaky too, and only the revival builds fresh.
      connect: () => portalOf(built++ < 2 ? flaky : good, revivals),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/register", REGISTER, session);
    expect(res.status).toBe(200);
    expect(revivals.count).toBe(1);
  });
  test("an empty register under a live session spends one revival, then answers 502", async () => {
    const revivals = { count: 0 };
    const api = createApi({
      connect: () =>
        portalOf(
          readerWith({
            register: () => Promise.resolve(""),
          }),
          revivals
        ),
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/register", REGISTER, session);
    expect(res.status).toBe(502);
    expect(revivals.count).toBe(1);
  });
  test("a still-stale register after the revival answers 502, never a third try", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      register: () => Promise.reject(new HttpError(502, "proxy hiccup")),
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    const api = createApi({ connect: () => portalOf(flaky, revivals) });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/register", REGISTER, session);
    expect(res.status).toBe(502);
    expect(revivals.count).toBe(1);
  });
  test("a 401 from the register revival signs out at once", async () => {
    const revivals = { count: 0 };
    const flaky = readerWith({
      register: () => Promise.reject(new HttpError(502, "proxy hiccup")),
      courses: () => Promise.reject(new HttpError(502, "proxy hiccup")),
    });
    let built = 0;
    const api = createApi({
      connect: () => {
        const n = built++;
        return portalOf(
          flaky,
          revivals,
          // The revival's own sign-in is refused: the credential is dead.
          n >= 2 ? new HttpError(401, "bad password") : undefined
        );
      },
    });
    const session = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/register", REGISTER, session);
    expect(res.status).toBe(401);
    expect(revivals.count).toBe(1);
    expect(res.headers.get(SESSION_HEADER)).toBe(null);
  });
  test("a session stored without a credential is signed out, not signed in again", async () => {
    const revivals = { count: 0 };
    const api = createApi({
      connect: () =>
        portalOf(readerWith({ courses: () => Promise.resolve([]) }), revivals),
    });
    const res = await call(api, "/api/session", {
      headers: {
        [SESSION_HEADER]: stored({ password: undefined }),
      },
    });
    expect((await res.json()) as SessionReply).toMatchObject({
      signedIn: false,
    });
    expect(revivals.count).toBe(0);
  });
  test("a 502 while signing in again keeps the credential, and signs nobody out", async () => {
    const revivals = { count: 0 };
    const api = createApi({
      connect: () =>
        portalOf(
          readerWith({ courses: expiredCourses }),
          revivals,
          new Error("ECONNRESET")
        ),
    });
    const res = await call(api, "/api/session", {
      headers: { [SESSION_HEADER]: stored() },
    });
    expect((await res.json()) as SessionReply).toMatchObject({
      signedIn: true,
    });
    expect(revivals.count).toBe(1);
    // The answer still carries the credential, so the browser keeps it.
    const kept = res.headers.get(SESSION_HEADER) ?? "";
    expect(kept).not.toBe("");
  });
  test("a 502 while signing in again mid-request is left alone, credential and all", async () => {
    const revivals = { count: 0 };
    let built = 0;
    const api = createApi({
      connect: () =>
        built++ === 0
          ? portalOf(readerWith({ courses: expiredCourses }), revivals)
          : portalOf(readerWith(), revivals, new Error("ECONNRESET")),
    });
    const session = stored();
    const res = await post(api, "/api/options", { course: "1" }, session);
    expect(res.status).toBe(502);
    expect(revivals.count).toBe(1);
    // A refusal carries no session, but the browser still holds its copy, so
    // the next probe answers signed in rather than signed out.
    const after = await call(api, "/api/session", {
      headers: { [SESSION_HEADER]: session },
    });
    expect((await after.json()) as SessionReply).toMatchObject({
      signedIn: true,
    });
  });
  test("a 401 while signing in again ends the session, and answers nothing to store", async () => {
    const revivals = { count: 0 };
    let built = 0;
    const api = createApi({
      connect: () =>
        built++ === 0
          ? portalOf(readerWith({ courses: expiredCourses }), revivals)
          : portalOf(
              readerWith(),
              revivals,
              new HttpError(401, "wrong password")
            ),
    });
    const res = await post(api, "/api/options", { course: "1" }, stored());
    expect(res.status).toBe(401);
    expect(revivals.count).toBe(1);
    // No session comes back, so the browser drops what it holds.
    expect(res.headers.get(SESSION_HEADER)).toBeNull();
  });
  test("the probe signs in again once, and keeps the portal it got", async () => {
    const revivals = { count: 0 };
    let built = 0;
    const api = createApi({
      connect: () =>
        portalOf(
          built++ === 0
            ? readerWith({ courses: expiredCourses })
            : readerWith(),
          revivals
        ),
    });
    const probe = async () => {
      const res = await call(api, "/api/session", {
        headers: { [SESSION_HEADER]: stored() },
      });
      return (await res.json()) as SessionReply;
    };
    expect(await probe()).toMatchObject({ signedIn: true });
    expect(await probe()).toMatchObject({ signedIn: true });
    expect(revivals.count).toBe(1);
  });
  test("a sign-in that is refused does not break the session you already have", async () => {
    const revivals = { count: 0 };
    const api = createApi({
      connect: () =>
        portalOf(readerWith(), revivals, new HttpError(401, "wrong password")),
    });
    const refused = await post(
      api,
      "/api/login",
      { userId: "someone", password: "nope" },
      stored()
    );
    expect(refused.status).toBe(401);
    const res = await call(api, "/api/session", {
      headers: { [SESSION_HEADER]: stored() },
    });
    expect((await res.json()) as SessionReply).toMatchObject({
      signedIn: true,
    });
  });
  test("no session is a 401 on data, and signed out on the probe", async () => {
    const api = createApi({
      connect: () => portalOf(readerWith(), { count: 0 }),
    });
    const res = await post(api, "/api/options", { course: "1" });
    expect(res.status).toBe(401);
    const probe = await call(api, "/api/session");
    expect((await probe.json()) as SessionReply).toMatchObject({
      signedIn: false,
    });
  });
  test("a session that is not a session is refused, never a crash", async () => {
    const api = createApi({
      connect: () => portalOf(readerWith(), { count: 0 }),
    });
    for (const bad of [
      "not-base64!!!",
      Buffer.from("[]", "utf-8").toString("base64url"),
      Buffer.from(
        JSON.stringify({ userId: "", cookies: [], at: Date.now() }),
        "utf-8"
      ).toString("base64url"),
      Buffer.from(
        JSON.stringify({ userId: "x", cookies: [["a"]], at: Date.now() }),
        "utf-8"
      ).toString("base64url"),
    ]) {
      const res = await post(api, "/api/options", { course: "1" }, bad);
      expect(res.status).toBe(401);
      const probe = await call(api, "/api/session", {
        headers: { [SESSION_HEADER]: bad },
      });
      expect((await probe.json()) as SessionReply).toMatchObject({
        signedIn: false,
      });
    }
  });
  test("a session older than thirty days of not using it is refused", async () => {
    const api = createApi({
      connect: () => portalOf(readerWith(), { count: 0 }),
    });
    const stale = stored({ at: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    const res = await post(api, "/api/options", { course: "1" }, stale);
    expect(res.status).toBe(401);
  });
});
