import { test, expect } from "@playwright/test";

import type {
  Option,
  OptionsReply,
  OptionsRequest,
  Student,
} from "../shared/api";
import { ALL_SUBJECTS } from "../shared/api";
import {
  abbreviate,
  applyOptions,
  chosenFacts,
  chosenLevels,
  chosenText,
  defaultRange,
  rememberRangeStart,
  resetFor,
  runCascade,
  selectionAfter,
  rememberClass,
  savedClasses,
  forgetClass,
  startingRange,
  disabledLevels,
  isReady,
  registerRows,
  shouldContinue,
  subjectNameKey,
  tintFor,
  toPortalDate,
  visibleStudents,
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
/** The reply for a selection the Portal agrees with: every level offered. */
const fullReply = (): OptionsReply =>
  reply({
    course: ["1"],
    semester: ["3"],
    branch: ["4"],
    section: ["5"],
    subject: ["6"],
  });
test.describe("the cascade's selection rules", () => {
  test("every level auto-fills, so the chain populates itself", () => {
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
    expect(next.subject).toBe("6");
  });
  test("the subject auto-fills too, and lands on ALL SUBJECTS", () => {
    const next = applyOptions(
      sel({ course: "1", branch: "4", semester: "3", section: "5" }),
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [ALL_SUBJECTS.value, "6", "7"],
      })
    );
    expect(next.subject).toBe(ALL_SUBJECTS.value);
  });
  test("a section with no subjects at all leaves the subject empty", () => {
    const next = applyOptions(
      sel({ course: "1", branch: "4", semester: "3", section: "5" }),
      reply({
        course: ["1"],
        semester: ["3"],
        branch: ["4"],
        section: ["5"],
        subject: [],
      })
    );
    expect(next.subject).toBe("");
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
  test("the same naming as rows, for the panel's own table", () => {
    const facts = chosenFacts(
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
      }),
      { from: "01/10/2026", to: "16/10/2026" }
    );
    expect(facts).toEqual([
      { label: "Course", value: "L1" },
      { label: "Semester", value: "L3" },
      { label: "Branch", value: "L4" },
      { label: "Section", value: "L5" },
      { label: "Subject", value: "L6" },
      { label: "Period", value: "01/10/2026 to 16/10/2026" },
    ]);
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
  test("only a critical student is tinted", () => {
    // The irregular tint was removed on purpose: a class with a third of its
    // roster irregular is a class with a third of its rows coloured, and then the
    // colour stops meaning anything.
    expect(tintFor({ ...student(40), critical: true })).toBe(
      "var(--mantine-color-red-light)"
    );
    expect(
      tintFor({ ...student(70), irregular: true, critical: false }),
      "an irregular student is badged low, not tinted"
    ).toBeUndefined();
    expect(tintFor({ ...student(90), irregular: false })).toBeUndefined();
  });
  test("an unparseable percentage is never tinted", () => {
    const unknown = { ...student(null), irregular: false, critical: false };
    expect(tintFor(unknown)).toBeUndefined();
  });
  test("tint is a Mantine token or nothing, never a custom rule", () => {
    expect(tintFor({ ...student(40), critical: true })).toBe(
      "var(--mantine-color-red-light)"
    );
    expect(tintFor(student(90))).toBeUndefined();
  });
  test("the tint reads the band the table is showing", () => {
    // On All subjects there is no subject figure, so reading the subject band
    // would leave every row untinted in the very view that exists to expose a
    // student critical across the section.
    const healthyInSubjectCriticalOverall = {
      ...student(90),
      critical: false,
      overallCritical: true,
    };
    expect(tintFor(healthyInSubjectCriticalOverall)).toBeUndefined();
    expect(tintFor(healthyInSubjectCriticalOverall, true)).toBe(
      "var(--mantine-color-red-light)"
    );
  });
});
test.describe("the rows as shown", () => {
  /* Descending attendance on purpose. A roster shaped this way is already the
   * wrong way round for a lowest-first sort, so a sort cannot pass by agreeing
   * with the Portal's order — which is the whole point of the check. */
  const roster = [
    { ...student(90), sl: "1", roll: "A" },
    { ...student(70), sl: "2", roll: "B" },
    { ...student(40), sl: "3", roll: "C" },
  ];
  test("the rows stay in the Portal's own order", () => {
    // The register used to be sorted lowest-first. That is a league table, not a
    // roster, and it broke the Sl.No column's job of tying a row to the Portal.
    expect(registerRows(roster, false, false).map((s) => s.roll)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
  test("the Portal's order survives the irregular filter's membership", () => {
    // Filtering drops rows; it does not invent rows. A is healthy and must not
    // appear just because the other two are being sorted.
    expect(
      registerRows(roster, true, false)
        .map((s) => s.roll)
        .toSorted()
    ).toEqual(["B", "C"]);
  });
  test("ticking the box sorts the students by attendance, worst first", () => {
    // The filtered table exists to be worked through: the student who most needs a
    // check-in should be the first one reached. That is the whole reason to sort,
    // and it is why this is a separate case from the unfiltered table.
    expect(registerRows(roster, true, false).map((s) => s.roll)).toEqual([
      "C",
      "B",
    ]);
  });
  test("the filtered sort reads the figure the table is showing", () => {
    // Both rows are in the filtered set, and they are in the wrong order for the
    // sort to pass by accident. On All subjects there is no subject percentage, so
    // sorting by it would leave every row on a dash and the order arbitrary.
    const mildOverall = {
      ...student(95),
      sl: "1",
      roll: "A",
      overallPct: 71,
      overallIrregular: true,
    };
    const worstOverall = {
      ...student(95),
      sl: "2",
      roll: "B",
      overallPct: 42,
      overallIrregular: true,
      overallCritical: true,
    };
    expect(
      registerRows([mildOverall, worstOverall], true, true).map((s) => s.roll)
    ).toEqual(["B", "A"]);
  });
  test("a student with no percentage sorts last, not first", () => {
    // `null` means the Portal gave no figure, which is not good attendance.
    // Putting such a student at the top of a triage list sends someone to check
    // on them for the wrong reason — which is the same class of error as showing
    // a dash as if it were a zero.
    const unknownFigure = {
      ...student(70),
      sl: "1",
      roll: "U",
      pct: null,
    };
    expect(
      registerRows([unknownFigure, ...roster], true, false).map((s) => s.roll)
    ).toEqual(["C", "B", "U"]);
  });
  test("a student kept only for the overall figure is not buried", () => {
    // The trap: on a Subject register the filter admits a student for being
    // Irregular *overall* even when they have no subject figure at all. Sorting
    // on the subject figure alone pushed the very student the worklist exists to
    // surface to the bottom of it, which is the opposite of the request.
    //
    // U is on 52% overall, so the worklist reads C 40, U 52, B 70 — and U is
    // judged on the figure that actually put them in it.
    const noSubjectFigure = {
      ...student(70),
      sl: "1",
      roll: "U",
      pct: null,
      irregular: false,
      overallPct: 52,
      overallIrregular: true,
      overallCritical: true,
    };
    expect(
      registerRows([noSubjectFigure, ...roster], true, false).map((s) => s.roll)
    ).toEqual(["C", "U", "B"]);
  });
  test("the caller's array is never sorted in place", () => {
    const input = [...roster];
    registerRows(input, false, false);
    registerRows(input, true, false);
    expect(input.map((s) => s.roll)).toEqual(["A", "B", "C"]);
  });
});

test.describe("show only irregular", () => {
  /** A student the Subject path would hide and the All subjects path would keep:
   *  healthy in the Subject, Critical across the Section. */
  const subjectCleanOverallBad = {
    ...student(90),
    overallPct: 58,
    overallIrregular: true,
    overallCritical: true,
  };
  test("on a Subject register, a student Critical overall is kept", () => {
    const kept = visibleStudents([subjectCleanOverallBad], true, false);
    expect(
      kept.map((s) => s.roll),
      "the case the overall feature exists to catch was filtered out"
    ).toEqual(["21CS001"]);
  });
  test("on the All subjects path the overall band is what is read", () => {
    const healthySubject = { ...student(40), overallPct: 95 };
    expect(
      visibleStudents([healthySubject], true, true),
      "a Subject problem does not make an overall problem"
    ).toEqual([]);
  });
  test("a student in neither band is always filtered out", () => {
    expect(visibleStudents([student(90)], true, false)).toEqual([]);
    expect(visibleStudents([student(90)], true, true)).toEqual([]);
  });
  test("the filter is off by default, and keeps the healthy alongside the bad", () => {
    const roster = [student(90), subjectCleanOverallBad];
    expect(visibleStudents(roster, false, false)).toHaveLength(2);
    expect(visibleStudents(roster, false, true)).toHaveLength(2);
  });
  test("the boundary is the band's own, and no threshold is invented here", () => {
    const exactlySeventyFive = {
      ...student(75),
      irregular: false,
      overallPct: 75,
      overallIrregular: false,
    };
    expect(visibleStudents([exactlySeventyFive], true, false)).toEqual([]);
    expect(visibleStudents([exactlySeventyFive], true, true)).toEqual([]);
  });
});
/** Node has no localStorage, and the range helpers are written to survive its
 *  absence, so without this the remembered-start tests pass for the wrong
 *  reason: every write throws, every read falls back. */
const saved = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => saved.set(k, v),
  removeItem: (k: string) => saved.delete(k),
  clear: () => saved.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

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

test.describe("a branch name on a card", () => {
  test("words before the bracket become initials", () => {
    expect(
      abbreviate("Computer Science and Engineering (Artificial Intelligence)")
    ).toBe("CSE(AI)");
    expect(abbreviate("Information Technology")).toBe("IT");
    expect(abbreviate("Electronics and Communication Engineering")).toBe("ECE");
  });
  test("the bracket keeps its own initialism, and a whole phrase is shortened", () => {
    expect(
      abbreviate("Computer Science and Engineering (Artificial Intelligence)")
    ).toBe("CSE(AI)");
    expect(abbreviate("Computer Science and Engineering (CSE)")).toBe("CSE");
    expect(abbreviate("Computer Science and Engineering (AIML)")).toBe(
      "CSE(AIML)"
    );
  });
  test("connecting words are not initials of their own", () => {
    expect(abbreviate("Computer Science and Engineering")).toBe("CSE");
    expect(abbreviate("Bachelor of Technology")).toBe("BT");
  });
  test("a single word is left alone, because an initial says nothing", () => {
    expect(abbreviate("Mathematics")).toBe("Mathematics");
    expect(abbreviate("Physics")).toBe("Physics");
  });
  test("an already short name is never made longer", () => {
    expect(abbreviate("CSE")).toBe("CSE");
    expect(abbreviate("IT")).toBe("IT");
    expect(abbreviate("")).toBe("");
  });
});

const CLASS_A: Sel = {
  course: "1",
  semester: "3",
  branch: "5",
  section: "A",
  subject: "101",
};
test.describe("what a changed level clears below it", () => {
  test("opening a saved class keeps the subject it names", () => {
    expect(
      resetFor("section", CLASS_A),
      "clearing the subject made the card open ALL SUBJECTS instead"
    ).toEqual([]);
  });
  test("changing the section by hand still clears the subject", () => {
    expect(resetFor("section", sel({ section: "A" }))).toEqual(["subject"]);
    expect(resetFor("section")).toEqual(["subject"]);
  });
  test("changing a higher level clears everything below it", () => {
    expect(resetFor("course")).toEqual([
      "semester",
      "branch",
      "section",
      "subject",
    ]);
    expect(resetFor("semester")).toEqual(["section", "subject"]);
    expect(resetFor("branch")).toEqual(["section", "subject"]);
  });
  test("changing the subject clears nothing below it", () => {
    expect(resetFor("subject", CLASS_A)).toEqual([]);
  });
});
test.describe("the saved classes", () => {
  const OTHER_SECTION: Sel = {
    course: "1",
    semester: "3",
    branch: "5",
    section: "B",
    subject: "101",
  };
  const OTHER_SUBJECT: Sel = { ...CLASS_A, subject: "102" };
  test("a class that was saved comes back after a reload", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
  });
  test("the subject is saved, so a card opens that subject's register", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", OTHER_SUBJECT);
    expect(savedClasses("sirichandrasekhar")[0]?.subject).toBe("102");
  });
  test("two subjects in one section are two classes", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SUBJECT);
    expect(savedClasses("sirichandrasekhar")).toEqual([OTHER_SUBJECT, CLASS_A]);
  });
  test("classes from any section are all kept", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SECTION);
    expect(savedClasses("sirichandrasekhar")).toEqual([OTHER_SECTION, CLASS_A]);
  });
  test("saving the same class twice keeps one of it", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
  });
  test("the newest save is offered first, and re-saving moves rather than adds", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SECTION);
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A, OTHER_SECTION]);
  });
  test("no date is ever stored with a class", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    const raw = saved.get("section-sirichandrasekhar") ?? "";
    expect(raw, "the range belongs to the register").not.toMatch(
      /\d{4}-\d{2}-\d{2}/
    );
  });
  test("a save with no subject is not offered back", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", { ...CLASS_A, subject: "" });
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
  });
  test("a save missing any level is not offered back", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", { ...CLASS_A, section: "" });
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
  });
  test("one user's classes are never handed to the next", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    // Readable for its owner first: without this, the assertion below passes for
    // the wrong reason on any build where nothing is readable at all.
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
    expect(savedClasses("someone-else")).toEqual([]);
  });
  test("forgetting one leaves the others", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    rememberClass("sirichandrasekhar", OTHER_SUBJECT);
    forgetClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toEqual([OTHER_SUBJECT]);
  });
  test("the same subject code in two sections keeps its own name", () => {
    // A subject code repeats across branches, so the label saved for Section-A's
    // "101" must not become Section-B's "101" name. Both classes survive a reload
    // and both are still named, each with its own.
    const sameCodeOtherSection: Sel = {
      course: "1",
      semester: "3",
      branch: "7",
      section: "B",
      subject: "101",
    };
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks");
    rememberClass("sirichandrasekhar", sameCodeOtherSection, "Discrete Maths");
    const restored = savedClasses("sirichandrasekhar");
    expect(
      restored.map((s) => s.label).toSorted(),
      "a shared subject code let one section's name overwrite the other's"
    ).toEqual(["Computer Networks", "Discrete Maths"]);
  });
  test("a name key is never the bare subject value", () => {
    // The guard on the key itself, because the collision above is invisible until
    // two sections happen to share a code. Value-only keys pass everything else.
    expect(subjectNameKey("A", "101")).not.toBe("101");
    expect(subjectNameKey("B", "101")).not.toBe(subjectNameKey("A", "101"));
  });
  test("a saved class is named again after a reload, with no portal call", () => {
    // A card that cannot name its own subject makes the user open every card once
    // per browser session before the screen is readable.
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks");
    const [restored] = savedClasses("sirichandrasekhar");
    expect(restored?.label).toBe("Computer Networks");
  });
  test("the name is the subject's, never the one already stored", () => {
    // Re-saving the same class with a new label must replace it, not keep the
    // first — otherwise a renamed subject stays wrong however often it is saved.
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks");
    rememberClass("sirichandrasekhar", CLASS_A, "Computer Networks II");
    const [restored] = savedClasses("sirichandrasekhar");
    expect(restored?.label).toBe("Computer Networks II");
  });
  test("saving without a name still offers the class", () => {
    // The label is a cache, not part of the identity: a class saved with no label
    // must still open rather than being dropped.
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    expect(savedClasses("sirichandrasekhar")).toHaveLength(1);
    expect(savedClasses("sirichandrasekhar")[0]?.label).toBeUndefined();
  });
  test("a refused storage saves nothing and breaks nothing", () => {
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(() => rememberClass("sirichandrasekhar", CLASS_A)).not.toThrow();
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
    expect(() => forgetClass("sirichandrasekhar", CLASS_A)).not.toThrow();
    globalThis.localStorage = real;
  });
  test("a stored value that is not a list of classes is refused", () => {
    saved.clear();
    saved.set("section-sirichandrasekhar", "{not json");
    expect(savedClasses("sirichandrasekhar")).toEqual([]);
    saved.set("section-sirichandrasekhar", JSON.stringify({ course: "1" }));
    expect(
      savedClasses("sirichandrasekhar"),
      "a single object is not a list, and half-reading it invents a class"
    ).toEqual([]);
    saved.set(
      "section-sirichandrasekhar",
      JSON.stringify([{ course: "1" }, CLASS_A])
    );
    expect(
      savedClasses("sirichandrasekhar"),
      "one bad entry costs itself, not the rest"
    ).toEqual([CLASS_A]);
  });
  test("a class saved with no subject is dropped, not offered blank", () => {
    saved.clear();
    saved.set(
      "section-sirichandrasekhar",
      JSON.stringify([{ ...CLASS_A, subject: "" }, OTHER_SUBJECT])
    );
    expect(
      savedClasses("sirichandrasekhar"),
      "an entry from before subjects were saved cannot name a register"
    ).toEqual([OTHER_SUBJECT]);
  });
  test("a class saved as one object is still offered", () => {
    saved.clear();
    rememberClass("sirichandrasekhar", CLASS_A);
    saved.set("section-sirichandrasekhar", JSON.stringify(CLASS_A));
    expect(savedClasses("sirichandrasekhar")).toEqual([CLASS_A]);
  });
});
test.describe("the cascade's option loop", () => {
  const SETTLED: Sel = {
    course: "1",
    semester: "3",
    branch: "4",
    section: "5",
    subject: "6",
  };
  test("a manual section change clears the subject, and a saved class keeps its own", () => {
    const full = sel(SETTLED);
    expect(
      selectionAfter(full, "section"),
      "made by hand, so nothing below it survives"
    ).toEqual({ ...SETTLED, subject: "" });
    expect(
      selectionAfter(full, "section", full),
      "arrived whole, so it keeps the subject it names"
    ).toEqual(full);
  });
  test("a run keeps asking while a level below a chosen one is still empty", async () => {
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(), known: nothing },
      (request) => {
        runs.push(request);
        const pass = runs.length;
        const fill = (level: number, value: string) =>
          pass >= level ? [value] : [];
        return Promise.resolve(
          reply({
            course: fill(1, "1"),
            semester: fill(2, "3"),
            branch: fill(3, "4"),
            section: fill(4, "5"),
            subject: fill(5, "6"),
          })
        );
      }
    );
    expect(
      runs.length,
      "one pass per level, each asked for by the pass before it"
    ).toBe(5);
    expect(outcome?.sel).toEqual(SETTLED);
  });
  test("a selection that is already settled is one request", async () => {
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      (request) => {
        runs.push(request);
        return Promise.resolve(fullReply());
      }
    );
    expect(runs.length, "nothing is gained, so nothing more is asked").toBe(1);
    expect(outcome?.sel).toEqual(SETTLED);
  });
  test("a run that starts with a semester chosen sends its title as the batch", async () => {
    const runs: OptionsRequest[] = [];
    const known = reply({
      course: ["1"],
      semester: [],
      branch: [],
      section: [],
      subject: [],
    });
    known.semester = [opt("3", "III Semester", "2025")];
    await runCascade(
      { seed: sel({ course: "1", semester: "3" }), known },
      (request) => {
        runs.push(request);
        return Promise.resolve(fullReply());
      }
    );
    expect(
      runs[0]?.semesterTitle,
      "the Portal wants the batch number beside the semester's value"
    ).toBe("2025");
  });
  test("a run keeps every subject name it was offered, but not the whole-section entry", async () => {
    const outcome = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      () => {
        const one = fullReply();
        one.subject = [ALL_SUBJECTS, opt("6", "DATA STRUCTURES")];
        return Promise.resolve(one);
      }
    );
    expect(outcome?.names.get(subjectNameKey("5", "6"))).toBe(
      "DATA STRUCTURES"
    );
    expect(
      outcome?.names.has(subjectNameKey("5", ALL_SUBJECTS.value)),
      "All subjects is a way of asking, not a subject"
    ).toBe(false);
  });
  test("a run superseded while the Portal is being asked stops there and answers nothing", async () => {
    const controller = new AbortController();
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(SETTLED), known: nothing, signal: controller.signal },
      (request) => {
        runs.push(request);
        // A newer change landed while this one was in flight. This pass settles
        // the chain, so nothing more would be asked even without the check — but
        // the answer is the one before the newer change, and the screen must not
        // take it.
        controller.abort();
        return Promise.resolve(fullReply());
      }
    );
    expect(outcome, "a superseded run must not write to the screen").toBeNull();
    expect(runs.length).toBe(1);
  });
  test("a run superseded on a pass that had more to do asks no further", async () => {
    const controller = new AbortController();
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(), known: nothing, signal: controller.signal },
      (request) => {
        runs.push(request);
        controller.abort();
        return Promise.resolve(
          reply({
            course: ["1"],
            semester: [],
            branch: [],
            section: [],
            subject: [],
          })
        );
      }
    );
    expect(outcome).toBeNull();
    expect(runs.length, "and must not keep asking the Portal").toBe(1);
  });
  test("a run that is already superseded asks the Portal nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(), known: nothing, signal: controller.signal },
      (request) => {
        runs.push(request);
        return Promise.resolve(fullReply());
      }
    );
    expect(outcome).toBeNull();
    expect(runs.length, "not even once").toBe(0);
  });
});
