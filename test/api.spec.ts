import { expect, test } from "@playwright/test";

import { createApi } from "../server/api";
import type { PortalPort } from "../server/api";
import { CookieJar } from "../server/portal-conventions";
import { HttpError } from "../server/portal-replies";
import type { PortalReader } from "../server/server-routes";
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
    studentProfile: () => Promise.resolve(""),
    studentWise: () => Promise.resolve(""),
    todayClasses: () => Promise.resolve(""),
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
    jar,
    signedIn: true,
    reader,
    courses: () => reader.courses(),
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
  test("a 502 is not retried, and does not sign anyone out", async () => {
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
    expect(revivals.count).toBe(0);
    const after = await call(api, "/api/session", {
      headers: { [SESSION_HEADER]: session },
    });
    expect((await after.json()) as SessionReply).toMatchObject({
      signedIn: true,
    });
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
