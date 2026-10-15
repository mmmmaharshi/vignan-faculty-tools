import { expect, test } from "@playwright/test";

import { createApi } from "../api";
import type { PortalPort } from "../api";
import { CookieJar } from "../portal-conventions";
import { HttpError } from "../portal-replies";
import type { PortalReader } from "../server-routes";
import { saveSessions } from "../session-store";
import type { Secrets, StoredSession } from "../session-store";
import type {
  OptionsReply,
  RegisterRequest,
  SessionReply,
} from "../shared/api";

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
function fakeVault(): Secrets {
  const store = new Map<string, string>();
  return {
    get: (name) => Promise.resolve(store.get(name) ?? null),
    set: (name, value) => {
      store.set(name, value);
      return Promise.resolve();
    },
    delete: (name) => Promise.resolve(store.delete(name)),
  };
}
function readerWith(over: Partial<PortalReader> = {}): PortalReader {
  return {
    courses: () => Promise.resolve([COURSE]),
    branchesAndSemesters: () => Promise.resolve([[], []]),
    sections: () => Promise.resolve([]),
    subjects: () => Promise.resolve([]),
    register: () => Promise.resolve(""),
    classAttendance: () => Promise.resolve(""),
    ...over,
  };
}
/** A portal over one reader, counting the revivals it was asked to perform. */
function portalOf(
  reader: PortalReader,
  revivals: { count: number }
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
      return Promise.resolve();
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
  id?: string
): Promise<Response> {
  return call(api, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(id ? { cookie: `ecap_sid=${id}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function signIn(api: Api): Promise<string> {
  const res = await post(api, "/api/login", {
    userId: "sirichandrasekhar",
    password: "hunter2",
  });
  const header = res.headers.get("set-cookie") ?? "";
  return /ecap_sid=(?<id>[^;]+)/.exec(header)?.groups?.id ?? "";
}
test.describe("handleApi", () => {
  test("a 401 mid-request signs in again, and the original call is retried", async () => {
    const revivals = { count: 0 };
    const expired = readerWith({
      courses: () => Promise.reject(new HttpError(401, "expired")),
    });
    let built = 0;
    const api = createApi({
      vault: fakeVault(),
      connect: () => portalOf(built++ === 0 ? expired : readerWith(), revivals),
    });
    const id = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/options", { course: "1" }, id);
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
      vault: fakeVault(),
      connect: () => portalOf(expired, revivals),
    });
    const id = await signIn(api);
    revivals.count = 0;
    const res = await post(api, "/api/options", { course: "1" }, id);
    expect(res.status).toBe(401);
    expect(revivals.count).toBe(1);
  });
  test("a 502 is not retried, and does not sign anyone out", async () => {
    const revivals = { count: 0 };
    const api = createApi({
      vault: fakeVault(),
      connect: () =>
        portalOf(
          readerWith({
            register: () =>
              Promise.reject(new HttpError(502, "ECAP rejected the report")),
          }),
          revivals
        ),
    });
    const id = await signIn(api);
    revivals.count = 0;
    const failed = await post(api, "/api/register", REGISTER, id);
    expect(failed.status).toBe(502);
    expect(revivals.count).toBe(0);
    const after = await call(api, "/api/session", {
      headers: { cookie: `ecap_sid=${id}` },
    });
    expect((await after.json()) as SessionReply).toMatchObject({
      signedIn: true,
    });
  });
  test("a session stored without a credential is signed out, not signed in again", async () => {
    const vault = fakeVault();
    const stored: StoredSession = {
      id: "s1",
      at: Date.now(),
      userId: "sirichandrasekhar",
      cookies: [["frmAuth", "ok"]],
    };
    expect(await saveSessions(vault, [stored])).toBeNull();
    const revivals = { count: 0 };
    const api = createApi({
      vault,
      connect: () =>
        portalOf(readerWith({ courses: () => Promise.resolve([]) }), revivals),
    });
    await api.restoreSessions();
    const res = await call(api, "/api/session", {
      headers: { cookie: "ecap_sid=s1" },
    });
    expect((await res.json()) as SessionReply).toMatchObject({
      signedIn: false,
    });
    expect(revivals.count).toBe(0);
  });
});
