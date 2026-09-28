/**
 * `liveness` — is the ECAP session still alive?
 *
 * The whole module in one file, and it earns its own file precisely because it was
 * previously written twice in two layers: once in `server-routes.ts` where a fast
 * test could reach it, and once inside `server.ts`'s probe where nothing could. The
 * copy with no coverage is the one that shipped the bug this describes.
 *
 * The `unknown` cases are the interesting half. They are asserted as carefully as
 * `dead`, because the temptation to fold them into `dead` is exactly what would
 * sign a user out during a portal outage — the trade ADR 0002 and ADR 0013 both
 * refused.
 */
import { test, expect } from "@playwright/test";

import { liveness } from "../portal-liveness";
import { HttpError } from "../portal-replies";
import type { Option } from "../shared/api";

const course = (value: string, label: string): Option => ({
  value,
  title: "",
  label,
});

/** A reader that answers with whatever it is given, including a throw. */
const reader = (
  answer: Option[] | Error | (() => Option[] | Error)
): { courses: () => Promise<Option[]> } => ({
  courses: () => {
    const value = typeof answer === "function" ? answer() : answer;
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  },
});

test.describe("is this session alive?", () => {
  test("a real course means the portal is serving this session", async () => {
    expect(await liveness(reader([course("1", "B.Tech")]))).toBe("alive");
  });

  test("an empty course list is a dead session, not a layout change", async () => {
    // The bug. A signed-out request to the first calling convention answers 200
    // with valid JSON whose <select> holds only "-Select-", so every sign of life
    // looks good. Measured: a session 19 minutes old returns the real course, one
    // 22 minutes old returns the empty select — ECAP's own ~20-minute timeout.
    //
    // Every account has at least one course, so an empty list can only mean the
    // session is gone. Reading it as a layout change produced a signed-in dashboard
    // with five dead dropdowns and a warning blaming the portal's markup.
    expect(await liveness(reader([]))).toBe("dead");
  });

  test("the placeholder on its own is still an empty list", async () => {
    // A length test would pass this one, and then the reply would read as a
    // session. "-Select-" is a choice that resolves to nothing, so it is not a
    // course — `realOptions` is what the module uses, and this pins why.
    expect(await liveness(reader([course("0", "-Select-")]))).toBe("dead");
    expect(
      await liveness(reader([course("0", "-Select-"), course("1", "B.Tech")]))
    ).toBe("alive");
  });

  test("a 401 is a dead session", async () => {
    // The second calling convention inspects its reply for HTML and answers 401.
    expect(await liveness(reader(new HttpError(401, "no")))).toBe("dead");
  });

  test("a 502 is unknown, and unknown must not read as dead", async () => {
    // The refusal ADR 0002 and ADR 0013 both record, kept because it is the case
    // most likely to be "simplified" away. A 502 could equally be the portal down
    // or markup that has moved; signing a user out on it turns a transient outage
    // into a lost session. `unknown` is deliberately not `alive` either — the
    // caller has to say what it does about what it cannot resolve.
    expect(await liveness(reader(new HttpError(502, "unreadable")))).toBe(
      "unknown"
    );
  });

  test("every other failure is unknown too", async () => {
    // A network error, a timeout, a bug in this app. None of them is evidence the
    // session ended, and treating any of them as proof would be the same mistake
    // in a different coat.
    for (const error of [
      new HttpError(500, "boom"),
      new HttpError(404, "gone"),
      new Error("ECONNRESET"),
      new TypeError("x is not a function"),
    ]) {
      expect(
        await liveness(reader(error)),
        `${error.name}: ${error.message}`
      ).toBe("unknown");
    }
  });

  test("it never throws, because a caller asking liveness owes no catch", async () => {
    // The module's whole interface is a verdict. If it could reject, every caller
    // would need a try/catch, and the interesting case — a failing probe — would
    // be indistinguishable from a crashing one.
    await expect(
      liveness(reader(new Error("something nobody planned for")))
    ).resolves.toBe("unknown");
  });

  test("a reader that throws synchronously is unknown, not a crash", async () => {
    // `courses` is declared as returning a Promise, so a synchronous throw is a
    // contract violation rather than a normal failure. It is still caught: a probe
    // that crashes the server is worse than one that says "I do not know".
    const rude = {
      courses: (): Promise<Option[]> => {
        throw new Error("threw before returning a promise");
      },
    };
    expect(await liveness(rude)).toBe("unknown");
  });
});
