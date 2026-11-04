import { expect, test } from "@playwright/test";

import {
  noteTodayMemory,
  readTodayMemory,
  shownToday,
  writeTodayMemory,
} from "../web/home/today-memory";
import {
  defaultRange,
  rememberRangeStart,
  startingRange,
  toPortalDate,
} from "../web/register/cascade";
import { saved, slot } from "./support/cascade-harness";

test.describe("dates", () => {
  test("the portal's format is day first, and a partial date is refused", () => {
    expect(toPortalDate("2026-01-05")).toBe("05/01/2026");
    expect(toPortalDate("")).toBe("");
    expect(toPortalDate("2026-01")).toBe("");
    expect(toPortalDate("nonsense")).toBe("");
  });
  test("the app opens on the 1st of this month, not the year or a rolling window", () => {
    expect(defaultRange(new Date(2026, 8, 28, 12, 0, 0))).toEqual({
      from: "2026-09-01",
      to: "2026-09-28",
    });
  });
  test("the 1st of the month is the 1st, in a 30-day month and a 31-day one", () => {
    expect(defaultRange(new Date(2026, 3, 30, 12, 0, 0)).from).toBe(
      "2026-04-01"
    );
    expect(defaultRange(new Date(2026, 4, 31, 12, 0, 0)).from).toBe(
      "2026-05-01"
    );
    expect(defaultRange(new Date(2024, 1, 29, 12, 0, 0)).from).toBe(
      "2024-02-01"
    );
  });
  test("in January the 1st of the month is also the 1st of the year", () => {
    expect(defaultRange(new Date(2026, 0, 15, 12, 0, 0))).toEqual({
      from: "2026-01-01",
      to: "2026-01-15",
    });
  });
  test("on the 1st itself the range is a single day, not a negative one", () => {
    expect(defaultRange(new Date(2026, 8, 1, 0, 0, 0))).toEqual({
      from: "2026-09-01",
      to: "2026-09-01",
    });
  });
  test("midnight on the 1st does not slip back into the previous month", () => {
    const range = defaultRange(new Date(2026, 8, 1, 0, 0, 0));
    expect(range.from).toBe("2026-09-01");
    expect(range.to).toBe("2026-09-01");
  });
  test("with nothing remembered, the range is the month to date", () => {
    saved.clear();
    expect(startingRange(new Date(2026, 8, 28, 12, 0, 0))).toEqual({
      from: "2026-09-01",
      to: "2026-09-28",
    });
  });
  test("a start that was found once is the start from then on", () => {
    saved.clear();
    rememberRangeStart("2026-06-01");
    expect(startingRange(new Date(2026, 8, 28, 12, 0, 0))).toEqual({
      from: "2026-06-01",
      to: "2026-09-28",
    });
  });
  test("the end is always today, never the day it was remembered", () => {
    saved.clear();
    rememberRangeStart("2026-06-01");
    expect(startingRange(new Date(2026, 8, 28, 12, 0, 0)).to).toBe(
      "2026-09-28"
    );
    expect(startingRange(new Date(2026, 0, 5, 9, 30, 0)).to).toBe("2026-01-05");
  });
  test("a refused storage does not break the range", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(() => rememberRangeStart("2026-06-01")).not.toThrow();
    expect(startingRange(new Date(2026, 8, 28, 12, 0, 0))).toEqual({
      from: "2026-09-01",
      to: "2026-09-28",
    });
    globalThis.localStorage = real;
  });
  test("a single-digit month and day are zero-padded, so the input accepts them", () => {
    const range = defaultRange(new Date(2026, 0, 5, 9, 30, 0));
    expect(range.to).toBe("2026-01-05");
  });
});

test.describe("the today-table memory", () => {
  const day = "26/10/2026";
  const rows = [slot("Period 1", "08:45 AM- 09:35 AM")];
  test("a read stating periods is remembered under that date", () => {
    const memory = noteTodayMemory(null, day, rows);
    expect(memory).toEqual({ date: day, classes: rows });
  });
  test("a cleared evening never erases the table the day taught", () => {
    const memory = noteTodayMemory(null, day, rows);
    // ECAP's cleared day states no periods at all — not even untimed rows.
    expect(noteTodayMemory(memory, day, [])).toBe(memory);
  });
  test("midnight starts a new memory instead of merging days", () => {
    const memory = noteTodayMemory(null, day, rows);
    const next = [slot("Period 2", "09:35 AM- 10:25 AM")];
    expect(noteTodayMemory(memory, "27/10/2026", next)).toEqual({
      date: "27/10/2026",
      classes: next,
    });
  });
  test("the screen shows the fresh read where it states periods", () => {
    const memory = noteTodayMemory(null, day, rows);
    expect(shownToday(rows, memory, day)).toBe(rows);
    // ...and the memory where the fresh read is a cleared evening.
    expect(shownToday([], memory, day)).toBe(memory?.classes ?? null);
  });
  test("yesterday's table never survives midnight, and loading never flashes it", () => {
    const memory = noteTodayMemory(null, day, rows);
    expect(shownToday([], memory, "27/10/2026")).toEqual([]);
    expect(shownToday(null, memory, day)).toBeNull();
  });
  test("the table survives a reload until its date rolls", () => {
    saved.clear();
    const memory = noteTodayMemory(null, day, rows);
    if (!memory) throw new Error("expected a memory to persist");
    writeTodayMemory(memory);
    expect(readTodayMemory()).toEqual(memory);
  });
  test("a refused storage breaks neither the read nor the write", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    const memory = noteTodayMemory(null, day, rows);
    expect(() => {
      if (memory) writeTodayMemory(memory);
    }).not.toThrow();
    expect(readTodayMemory()).toBeNull();
    globalThis.localStorage = real;
  });
});
