import { expect, test } from "@playwright/test";

import { isLive } from "../web/data/format";

/**
 * Which period is running right now.
 *
 * A hand-written example proves one path through this arithmetic; the periods
 * that broke it were the ones at a boundary, after noon, and past midnight —
 * and the browser test that used to be the only guard built its period from the
 * current time, so half the day it exercised the other half of the code.
 */
const at = (hour: number, minute = 0): Date =>
  new Date(2026, 9, 14, hour, minute);

test.describe("the live period", () => {
  test("an afternoon range is live inside it and not outside it", () => {
    const range = "12:30 PM- 01:15 PM";
    expect(isLive(range, at(13, 0)), "inside").toBe(true);
    expect(isLive(range, at(12, 30)), "on its first minute").toBe(true);
    expect(isLive(range, at(13, 15)), "on the minute it ends").toBe(false);
    expect(isLive(range, at(12, 29)), "a minute before it starts").toBe(false);
  });

  test("noon is twelve, not zero", () => {
    // A bare `% 12` maps 12 PM to 0, which makes every afternoon range read as
    // live all morning and dead all afternoon.
    expect(isLive("12:00 PM- 12:30 PM", at(12, 10))).toBe(true);
    expect(isLive("12:00 PM- 12:30 PM", at(0, 10))).toBe(false);
    expect(isLive("12:00 AM- 12:30 AM", at(0, 10))).toBe(true);
  });

  test("a range that runs past midnight contains the early minutes", () => {
    const overnight = "11:50 PM- 12:20 AM";
    expect(isLive(overnight, at(23, 55)), "before midnight").toBe(true);
    expect(isLive(overnight, at(0, 10)), "after it").toBe(true);
    expect(isLive(overnight, at(1, 0)), "and not the hour after").toBe(false);
  });

  test("hours the grid did not state are never live", () => {
    expect(isLive("", at(9))).toBe(false);
    expect(isLive("08:45 AM- 09:35 AM", at(9, 0))).toBe(true);
    expect(isLive("08:45-09:35", at(9, 0)), "no half of the day").toBe(false);
  });
});
