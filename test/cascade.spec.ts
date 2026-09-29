import { test, expect } from "@playwright/test";

import type { Option, OptionsReply, Student } from "../shared/api";
import {
  applyOptions,
  chosenLevels,
  chosenText,
  defaultRange,
  disabledLevels,
  isReady,
  shouldContinue,
  tintFor,
  toPortalDate,
} from "../web/cascade";
import type { Level, Sel } from "../web/cascade";

const opt = (value: string, label = `L${value}`, title = ""): Option => ({
  value,
  label,
  title,
});
const reply = (perLevel: Record<Level, string[]>): OptionsReply => ({
  course: perLevel.course.map((v) => opt(v)),
  semester: perLevel.semester.map((v) => opt(v)),
  branch: perLevel.branch.map((v) => opt(v)),
  section: perLevel.section.map((v) => opt(v)),
  subject: perLevel.subject.map((v) => opt(v)),
  emptyLevels: [],
});
const sel = (partial: Partial<Sel> = {}): Sel => ({
  course: "",
  semester: "",
  branch: "",
  section: "",
  subject: "",
  ...partial,
});
const nothing = reply({
  course: [],
  semester: [],
  branch: [],
  section: [],
  subject: [],
});
test.describe("the cascade's selection rules", () => {
  test("every level above the subject auto-fills, so the chain populates itself", () => {
    const next = applyOptions(
      sel(),
      reply({
        course: ["1", "2"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: ["6", "7"],
      })
    );
    expect(next.course).toBe("1");
    expect(next.semester).toBe("3");
    expect(next.branch).toBe("4");
    expect(next.section).toBe("5");
  });
  test("the subject is never auto-chosen, because it decides which register loads", () => {
    for (const count of [1, 2, 9]) {
      const subjects = Array.from({ length: count }, (_, i) => String(i));
      const next = applyOptions(
        sel({ course: "1", branch: "4", semester: "3", section: "5" }),
        reply({
          course: ["1"],
          semester: ["3"],
          branch: ["4"],
          section: ["5"],
          subject: subjects,
        })
      );
      expect(next.subject).toBe("");
    }
  });
  test("a choice the server still offers survives a refresh", () => {
    const next = applyOptions(
      sel({ course: "2", branch: "4" }),
      reply({
        course: ["1", "2"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.course).toBe("2");
  });
  test("a choice the server no longer offers falls to the first option", () => {
    const next = applyOptions(
      sel({ course: "99" }),
      reply({
        course: ["1", "2"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.course).toBe("1");
  });
  test("a level with no options is cleared, not left holding a dead value", () => {
    const next = applyOptions(
      sel({ course: "1", branch: "4" }),
      reply({
        course: ["1"],
        semester: ["3"],
        branch: [],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.branch).toBe("");
  });
  test("a level is ready only when every level above it is chosen", () => {
    const full = sel({ course: "1", semester: "3", branch: "4", section: "5" });
    expect(isReady(full, "course")).toBe(true);
    expect(isReady(sel({ course: "1" }), "semester")).toBe(true);
    expect(isReady(sel(), "semester")).toBe(false);
    expect(isReady(sel({ course: "1", branch: "4" }), "branch")).toBe(false);
    expect(isReady(sel({ course: "1", semester: "3" }), "branch")).toBe(true);
    expect(isReady(sel({ course: "1", branch: "4" }), "section")).toBe(false);
    expect(isReady(full, "section")).toBe(true);
    expect(isReady(full, "subject")).toBe(true);
  });
  test("a dropdown is enabled exactly when the server could answer for it", () => {
    expect(disabledLevels(sel())).toEqual({
      course: false,
      semester: true,
      branch: true,
      section: true,
      subject: true,
    });
    const full = sel({ course: "1", semester: "3", branch: "4", section: "5" });
    expect(disabledLevels(full)).toEqual({
      course: false,
      semester: false,
      branch: false,
      section: false,
      subject: false,
    });
  });
});
test.describe("the loop's decision", () => {
  test("asks again when a pass settled a level and something below is now ready", () => {
    const before = sel({ course: "1" });
    const after = sel({ course: "1", semester: "3", branch: "4" });
    expect(shouldContinue(after, before, nothing)).toBe(true);
  });
  test("stops when a pass settled nothing, however ready the levels look", () => {
    const unchanged = sel({ course: "1", semester: "3" });
    expect(shouldContinue(unchanged, unchanged, nothing)).toBe(false);
  });
  test("stops when a pass gained something but every level below is filled", () => {
    const before = sel();
    const after = sel({ course: "1" });
    const full = reply({
      course: ["1"],
      semester: ["3"],
      branch: ["4"],
      section: ["5"],
      subject: ["6"],
    });
    expect(shouldContinue(after, before, full)).toBe(false);
  });
  test("stops when the deepest ready level came back populated but gained nothing", () => {
    const unchanged = sel();
    expect(
      shouldContinue(
        unchanged,
        unchanged,
        reply({
          course: ["1"],
          semester: [],
          branch: [],
          section: [],
          subject: [],
        })
      )
    ).toBe(false);
  });
});
test.describe("the register, before it is sent", () => {
  test("names the level that has no choice, so the warning can point at it", () => {
    const chosen = chosenLevels(
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: ["6"],
      }),
      sel({ course: "1", semester: "3" })
    );
    expect(chosen.ok).toBe(false);
    if (!chosen.ok) expect(chosen.label).toBe("Branch");
  });
  test("returns each level whole, labels included, not as a bare value", () => {
    const opts = reply({
      course: ["1"],
      semester: ["3"],
      branch: ["4"],
      section: ["5"],
      subject: ["6"],
    });
    const chosen = chosenLevels(
      opts,
      sel({
        course: "1",
        semester: "3",
        branch: "4",
        section: "5",
        subject: "6",
      })
    );
    expect(chosen.ok).toBe(true);
    if (chosen.ok) {
      expect(chosen.levels.course).toEqual(opts.course[0]);
      expect(chosen.levels.subject.label).toBe("L6");
    }
  });
  test("names the register on screen, so a stale read is visible", () => {
    const text = chosenText(
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: ["6"],
      }),
      sel({
        course: "1",
        semester: "3",
        branch: "4",
        section: "5",
        subject: "6",
      })
    );
    expect(text).toContain("Course: L1");
    expect(text).toContain("Subject: L6");
  });
});
const student = (pct: number | null): Student => ({
  sl: "1",
  roll: "21CS001",
  name: "A Student",
  attendedOfHeld: "38/45",
  pct,
  irregular: pct != null && pct < 75,
  critical: pct != null && pct < 60,
  overallPct: 79.21,
  overallAttendedOfHeld: "381\\481",
  overallIrregular: false,
  overallCritical: false,
});
test.describe("the bands", () => {
  test("worst band wins, so a student is never shown as merely irregular", () => {
    expect(tintFor({ ...student(40), irregular: true, critical: true })).toBe(
      "var(--mantine-color-red-light)"
    );
    expect(tintFor({ ...student(70), irregular: true, critical: false })).toBe(
      "var(--mantine-color-yellow-light)"
    );
    expect(tintFor({ ...student(90), irregular: false, critical: false })).toBe(
      undefined
    );
  });
  test("an unparseable percentage is never called critical or irregular", () => {
    const unknown = { ...student(null), irregular: false, critical: false };
    expect(tintFor(unknown)).toBeUndefined();
  });
  test("tint is a Mantine token or nothing, never a custom rule", () => {
    expect(tintFor({ ...student(40), critical: true })).toBe(
      "var(--mantine-color-red-light)"
    );
    expect(tintFor({ ...student(70), irregular: true })).toBe(
      "var(--mantine-color-yellow-light)"
    );
    expect(tintFor(student(90))).toBeUndefined();
  });
});
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
  test("a single-digit month and day are zero-padded, so the input accepts them", () => {
    const range = defaultRange(new Date(2026, 0, 5, 9, 30, 0));
    expect(range.to).toBe("2026-01-05");
  });
});
