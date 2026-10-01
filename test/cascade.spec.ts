import { test, expect } from "@playwright/test";

import type { Option, OptionsReply, Student } from "../shared/api";
import { ALL_SUBJECTS } from "../shared/api";
import {
  abbreviate,
  applyOptions,
  chosenLevels,
  chosenText,
  defaultRange,
  rememberRangeStart,
  resetFor,
  rememberClass,
  savedClasses,
  forgetClass,
  startingRange,
  disabledLevels,
  isReady,
  shouldContinue,
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
  test("several words become their initials", () => {
    expect(abbreviate("Information Technology")).toBe("IT");
    expect(abbreviate("Electronics and Communication Engineering")).toBe("ECE");
    expect(abbreviate("Artificial Intelligence & Machine Learning")).toBe(
      "AIML"
    );
  });
  test("a single word is left alone, because an initial says nothing", () => {
    expect(abbreviate("Mathematics")).toBe("Mathematics");
    expect(abbreviate("Physics")).toBe("Physics");
  });
  test("connecting words are not initials of their own", () => {
    expect(abbreviate("Computer Science and Engineering")).toBe("CSE");
    expect(abbreviate("Bachelor of Technology")).toBe("BT");
  });
  test("an already short name is never made longer", () => {
    expect(abbreviate("CSE")).toBe("CSE");
    expect(abbreviate("IT")).toBe("IT");
    expect(abbreviate("")).toBe("");
  });
  test("a name whose initials say nothing keeps one of its words", () => {
    // "Mining and Geology" abbreviates to "MG", not "M", and a lone initial
    // reads as a typo rather than as an abbreviation.
    expect(abbreviate("Mining")).toBe("Mining");
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
