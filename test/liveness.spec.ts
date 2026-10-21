import { test, expect } from "@playwright/test";

import { liveness } from "../server/portal-liveness";
import { HttpError } from "../server/portal-replies";
import type { Option } from "../shared/api";

const course = (value: string, label: string): Option => ({
  value,
  title: "",
  label,
});
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
    expect(await liveness(reader([]))).toBe("dead");
  });
  test("the placeholder on its own is still an empty list", async () => {
    expect(await liveness(reader([course("0", "-Select-")]))).toBe("dead");
    expect(
      await liveness(reader([course("0", "-Select-"), course("1", "B.Tech")]))
    ).toBe("alive");
  });
  test("a 401 is a dead session", async () => {
    expect(await liveness(reader(new HttpError(401, "no")))).toBe("dead");
  });
  test("a 502 is unknown, and unknown must not read as dead", async () => {
    expect(await liveness(reader(new HttpError(502, "unreadable")))).toBe(
      "unknown"
    );
  });
  test("every other failure is unknown too", async () => {
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
    await expect(
      liveness(reader(new Error("something nobody planned for")))
    ).resolves.toBe("unknown");
  });
  test("a reader that throws synchronously is unknown, not a crash", async () => {
    const rude = {
      courses: (): Promise<Option[]> => {
        throw new Error("threw before returning a promise");
      },
    };
    expect(await liveness(rude)).toBe("unknown");
  });
});
