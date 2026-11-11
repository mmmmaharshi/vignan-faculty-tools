import { test, expect } from "@playwright/test";
import {
  array,
  assert,
  asyncProperty,
  boolean,
  constant,
  constantFrom,
  integer,
  oneof,
  option,
  property,
  record,
  string,
  stringMatching,
  uniqueArray,
} from "fast-check";
import type { Arbitrary } from "fast-check";

import { ALL_SUBJECTS } from "../shared/api";
import type { Option, OptionsReply } from "../shared/api";
import { ApiError } from "../web/data/client";
import { applyOptions, EMPTY_OPTS, LEVEL_KEYS } from "../web/register/cascade";
import type { Sel } from "../web/register/cascade";
import { partialOf, runCascade } from "../web/register/cascade-run";
import {
  barCounts,
  cycleSubjectBar,
  displayName,
  isFiltering,
  NO_FILTER,
  pruneSubjectBars,
  registerRows,
  tintFor,
  visibleStudents,
} from "../web/register/worklist";
import type { RowFilter, StudentRow } from "../web/register/worklist";

/**
 * Properties over the register worklist and the cascade loop.
 *
 * These are the rules the repo argues about in prose: a bar may narrow a
 * roster but never admit a row, a missing figure sorts last, a failed cascade
 * pass keeps what already arrived. Each holds for every row and every filter,
 * which is the only way to say it once.
 */
const row = (i: number): StudentRow =>
  ({
    sl: String(i + 1),
    roll: `R${i}`,
    name: `Student ${i}`,
    attendedOfHeld: "",
    pct: null,
    irregular: false,
    critical: false,
    overallAttendedOfHeld: "",
    overallPct: null,
    overallIrregular: false,
    overallCritical: false,
    subjects: [],
    absent: [],
  }) as StudentRow;

const rows: Arbitrary<StudentRow[]> = array(
  record({
    pct: option(integer({ min: 0, max: 100 }), { nil: null }),
    overallPct: option(integer({ min: 0, max: 100 }), { nil: null }),
    irregular: boolean(),
    critical: boolean(),
    overallIrregular: boolean(),
    overallCritical: boolean(),
  }),
  { maxLength: 25 }
).map((specs) =>
  specs.map((spec, i) => ({
    ...row(i),
    ...spec,
    overallAttendedOfHeld: spec.overallPct == null ? "" : "1/2",
  }))
);

const filter: Arbitrary<RowFilter> = record<RowFilter>({
  irregular: boolean(),
  below75: boolean(),
  below65: boolean(),
  search: oneof(constant(""), constant("R1"), constant("student")),
  subjectBars: array(
    record({
      code: constantFrom("AI", "MFCS", "WT"),
      below: constantFrom(75 as const, 65 as const),
    }),
    { maxLength: 2 }
  ),
});

test.describe("a worklist is a subset of the roster", () => {
  test("no filter ever admits a row that was not there, or duplicates one", () => {
    assert(
      property(rows, filter, boolean(), (students, f, overallMode) => {
        const shown = visibleStudents(students, f, overallMode);
        expect(shown.length).toBeLessThanOrEqual(students.length);
        expect(new Set(shown.map((s) => s.roll)).size).toBe(shown.length);
        for (const s of shown) {
          expect(students.map((x) => x.roll)).toContain(s.roll);
        }
        return true;
      }),
      { numRuns: 200 }
    );
  });
  test("an unfiltered register keeps the Portal's own order", () => {
    assert(
      property(rows, (students) => {
        expect(registerRows(students, NO_FILTER, false)).toEqual(
          visibleStudents(students, NO_FILTER, false)
        );
        return true;
      }),
      { numRuns: 100 }
    );
  });
  test("a filtered register never puts a missing figure above a known one", () => {
    assert(
      property(rows, filter, boolean(), (students, f, overallMode) => {
        if (!isFiltering(f)) return true;
        const shown = registerRows(students, f, overallMode);
        const figure = (s: StudentRow) => (overallMode ? s.overallPct : s.pct);
        const firstMissing = shown.findIndex((s) => figure(s) == null);
        if (firstMissing === -1) return true;
        // Everything from the first absence of evidence onwards is missing one:
        // an unknown figure never sorts above a known one.
        return shown.slice(firstMissing).every((s) => figure(s) == null);
      }),
      { numRuns: 200 }
    );
  });
  test("each bar's count is at most the roster, and ignoring the other bars", () => {
    assert(
      property(rows, string(), boolean(), (students, search, overallMode) => {
        const counts = barCounts(students, search, overallMode);
        for (const n of Object.values(counts)) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(students.length);
        }
        return true;
      }),
      { numRuns: 150 }
    );
  });
  test("only a critical row is tinted", () => {
    assert(
      property(rows, boolean(), (students, overallMode) => {
        for (const s of students) {
          const critical = overallMode ? s.overallCritical : s.critical;
          expect(Boolean(tintFor(s, overallMode))).toBe(critical);
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

test.describe("a column threshold cycles in place", () => {
  test("three clicks return the bar set it started from", () => {
    assert(
      property(constantFrom("AI", "MFCS", "WT"), (code) => {
        const start: RowFilter["subjectBars"] = [];
        const once = cycleSubjectBar(start, code);
        const twice = cycleSubjectBar(once, code);
        const thrice = cycleSubjectBar(twice, code);
        expect(once).toEqual([{ code, below: 75 }]);
        expect(twice).toEqual([{ code, below: 65 }]);
        expect(thrice).toEqual(start);
        return true;
      }),
      { numRuns: 10 }
    );
  });
  test("pruning keeps a subset, and every kept bar names an offered subject", () => {
    assert(
      property(
        array(
          record({
            code: constantFrom("AI", "MFCS", "WT", "SE"),
            below: constantFrom(75 as const, 65 as const),
          }),
          { maxLength: 4 }
        ),
        uniqueArray(constantFrom("AI", "MFCS"), { maxLength: 2 }),
        (bars, labels) => {
          const kept = pruneSubjectBars(
            bars,
            labels.map((label) => ({ value: label, label, title: "" }))
          );
          expect(kept.length).toBeLessThanOrEqual(bars.length);
          for (const bar of kept) expect(labels).toContain(bar.code);
          return true;
        }
      ),
      { numRuns: 150 }
    );
  });
});

test.describe("a name reads as a reader writes it", () => {
  test("displayName is idempotent", () => {
    assert(
      property(string(), (name) => {
        const once = displayName(name);
        expect(displayName(once)).toBe(once);
        return true;
      }),
      { numRuns: 300 }
    );
  });
  test("displayName keeps the letters of the original", () => {
    assert(
      property(stringMatching(/^[A-Za-z ]*$/), (name) => {
        expect(displayName(name).replaceAll(" ", "").toLowerCase()).toBe(
          name.replaceAll(" ", "").toLowerCase()
        );
        return true;
      }),
      { numRuns: 200 }
    );
  });
});

const level = (value: string, label: string): Option => ({
  value,
  label,
  title: "",
});
const reply = (over: Partial<OptionsReply> = {}): OptionsReply => ({
  ...EMPTY_OPTS,
  course: [level("1", "B.Tech")],
  semester: [level("1", "III Semester")],
  branch: [level("1", "IT")],
  section: [level("1", "Section-A")],
  subject: [ALL_SUBJECTS, level("2", "MFCS")],
  ...over,
});

test.describe("the cascade loop keeps what it settled", () => {
  test("a run that fails keeps every level that had already arrived", async () => {
    // A stumble is retried once, so a failure is only reachable after two
    // consecutive bad passes: fail the same pass twice.
    await assert(
      asyncProperty(integer({ min: 1, max: 5 }), async (failAt) => {
        let pass = 0;
        // Not async: the answer is one fixed promise, so the retry rule sees
        // the same rejection twice.
        const fetchOptions = ((): Promise<OptionsReply> => {
          pass += 1;
          const ofPass = Math.ceil(pass / 2);
          return ofPass === failAt
            ? Promise.reject(new ApiError(502, "stumbled"))
            : Promise.resolve(reply());
        }) as Parameters<typeof runCascade>[1];
        try {
          const outcome = await runCascade(
            {
              seed: Object.fromEntries(LEVEL_KEYS.map((k) => [k, ""])) as Sel,
              known: EMPTY_OPTS,
            },
            fetchOptions
          );
          // Pass 1 always arrives, so a successful run has a course.
          expect(outcome?.sel.course).not.toBe("");
        } catch (error) {
          const partial = partialOf(error);
          if (!partial) return true; // failed before anything arrived
          // Pass 1 always arrives first, so a run that dies on pass 1 keeps
          // nothing and a run that dies later keeps at least the course.
          expect(partial.sel.course === "").toBe(failAt === 1);
        }
        return true;
      }),
      { numRuns: 5 }
    );
  });
  test("applyOptions never invents a value the Portal did not offer", () => {
    assert(
      property(string(), string(), (course, semester) => {
        const known = reply({
          course: [level("1", "B.Tech"), level("2", "M.Tech")],
          semester: [level("1", "III"), level("2", "V")],
        });
        const settled = applyOptions(
          { course, semester, branch: "", section: "", subject: "" } as Sel,
          known
        );
        expect(known.course.map((o) => o.value)).toContain(settled.course);
        expect(known.semester.map((o) => o.value)).toContain(settled.semester);
        return true;
      }),
      { numRuns: 200 }
    );
  });
});
