/**
 * The cascade's rules, tested without a portal or a browser.
 *
 * These are the rules ADR 0001 records as "wrong three separate times before it
 * was right", and until now no test could reach them: they lived in `App.tsx`,
 * which exports one symbol and mounts React when imported. Every case here is a
 * property of the rule - what it must never do - rather than a restatement of
 * its implementation, per CODING_STANDARDS.md.
 *
 * The end-to-end smoke test still covers the journey. It cannot cover these
 * branches, because reaching them means driving five dropdowns in a specific
 * order against a live portal, and the ones that matter most are the ones that
 * must NOT happen.
 */

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
  statusOf,
  tintFor,
  toPortalDate,
} from "../web/cascade";
import type { Level, Sel } from "../web/cascade";

/** An option, with the three fields the portal actually gives. */
const opt = (value: string, label = `L${value}`, title = ""): Option => ({
  value,
  label,
  title,
});

/** A reply where every level has the given values, labelled L<value>. */
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
    // The rule that dead-ended the chain before. Stopping at the first
    // multi-option level means the user has to drive all five; this way the
    // whole chain arrives and they override what they disagree with.
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
    // One option or fifty: pre-selecting risks showing the wrong roster.
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
    // Re-asserting the user's pick on every pass would reset a dropdown the
    // moment they moved to the level below it.
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
    // The old <select> behaved this way: a value not in the list cannot be
    // selected, so the browser showed the first entry. Keeping a dead value
    // would send it to the portal on the next request.
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
    // emptyLevels reports this to the user; keeping the old value would let a
    // register load against a level the server says is empty.
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
    // Cascade order is course, semester, branch, section, subject - so semester
    // depends on course alone. A level's dependencies are its position in
    // LEVELS, not the field order of the request body, and the two differ.
    const full = sel({ course: "1", semester: "3", branch: "4", section: "5" });

    expect(isReady(full, "course")).toBe(true); // nothing above it
    expect(isReady(sel({ course: "1" }), "semester")).toBe(true);
    expect(isReady(sel(), "semester")).toBe(false);

    // Branch needs course AND semester. Choosing branch without semester does
    // not make it ready, and this is the case that guards the server's ladder.
    expect(isReady(sel({ course: "1", branch: "4" }), "branch")).toBe(false);
    expect(isReady(sel({ course: "1", semester: "3" }), "branch")).toBe(true);

    expect(isReady(sel({ course: "1", branch: "4" }), "section")).toBe(false);
    expect(isReady(full, "section")).toBe(true);
    expect(isReady(full, "subject")).toBe(true);
  });

  test("a dropdown is enabled exactly when the server could answer for it", () => {
    // The same dependency condition, derived once. A hand-written five-boolean
    // map is where the two halves drift apart.
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
    // This is what makes the chain populate itself in one user action. Without
    // it the user would have to touch all five dropdowns by hand.
    const before = sel({ course: "1" });
    const after = sel({ course: "1", semester: "3", branch: "4" });
    expect(shouldContinue(after, before, nothing)).toBe(true);
  });

  test("stops when a pass settled nothing, however ready the levels look", () => {
    // Without this the dropdowns would spin forever the moment the server has
    // nothing left to give. The dead end is a quiet one - a spinner that never
    // stops - which is why it needs a test more than a comment.
    const unchanged = sel({ course: "1", semester: "3" });
    expect(shouldContinue(unchanged, unchanged, nothing)).toBe(false);
  });

  test("stops when a pass gained something but every level below is filled", () => {
    // Gained something, so a naive `gained` check would loop forever here.
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
    // Course always has options and is never auto-advanced past, so a reply
    // that only fills course must not keep the loop alive.
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
    // "Choose a branch first" beats "choose a level first", and the portal needs
    // every level whole or it answers with nothing at all.
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
    // The label-cache bug: the portal needs value AND visible text, and returns
    // nothing rather than failing when the text is missing.
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

/** A student at a given percentage, flagged the way the server flags them. */
const student = (pct: number | null): Student => ({
  sl: "1",
  roll: "21CS001",
  name: "A Student",
  attendedOfHeld: "38/45",
  pct,
  irregular: pct != null && pct < 75,
  critical: pct != null && pct < 60,
});

test.describe("the bands", () => {
  test("worst band first, so a student is never described two ways", () => {
    // The table's tint and the CSV's word come from this, and a student who is
    // both must not be reported as merely irregular.
    expect(statusOf({ ...student(40), irregular: true, critical: true })).toBe(
      "Critical"
    );
    expect(statusOf({ ...student(70), irregular: true, critical: false })).toBe(
      "Irregular"
    );
    expect(
      statusOf({ ...student(90), irregular: false, critical: false })
    ).toBe("Regular");
  });

  test("an unparseable percentage is never called critical or irregular", () => {
    // `pct: null` means the portal's cell would not parse. Claiming a band for it
    // would put a student in a list on the strength of nothing.
    const unknown = { ...student(null), irregular: false, critical: false };
    expect(statusOf(unknown)).toBe("Regular");
    expect(tintFor(unknown)).toBeUndefined();
  });

  test("tint is a Mantine token or nothing, never a custom rule", () => {
    // AGENTS.md: no custom CSS anywhere. A raw colour here would be the only
    // one in the project, and the smoke test would not catch it.
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
    // A short date silently becoming "01/undefined/2026" would ask the portal
    // for a range it answers with nothing.
    expect(toPortalDate("2026-01-05")).toBe("05/01/2026");
    expect(toPortalDate("")).toBe("");
    expect(toPortalDate("2026-01")).toBe("");
    expect(toPortalDate("nonsense")).toBe("");
  });

  test("the app opens on this calendar year, in the reader's own timezone", () => {
    // Constructed as local dates, deliberately, because that is the bug this
    // guards. `new Date(y, 0, 1)` is local midnight; reading it back through
    // toISOString() gives 31 December anywhere east of Greenwich, so the range
    // would start a day early for every reader in IST.
    const range = defaultRange(new Date(2026, 8, 28, 12, 0, 0));
    expect(range.from).toBe("2026-01-01");
    expect(range.to).toBe("2026-09-28");
  });

  test("midnight on 1 January does not slip back into the previous year", () => {
    // The exact instant the old toISOString() version got wrong.
    const range = defaultRange(new Date(2026, 0, 1, 0, 0, 0));
    expect(range.from).toBe("2026-01-01");
    expect(range.to).toBe("2026-01-01");
  });

  test("a single-digit month and day are zero-padded, so the input accepts them", () => {
    // A date input hands back "2026-01-05"; an unpadded "2026-1-5" is not a
    // value the input will accept, so the field would clear itself.
    const range = defaultRange(new Date(2026, 0, 5, 9, 30, 0));
    expect(range.to).toBe("2026-01-05");
  });
});
