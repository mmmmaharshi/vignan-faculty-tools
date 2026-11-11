import { expect, test } from "@playwright/test";

import {
  NO_FILTER,
  barCounts,
  carriesOverall,
  displayName,
  registerRows,
  tintFor,
} from "../web/register/worklist";
import { irregularOnly, student } from "./support/cascade-harness";

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
  test("a count without a percentage still counts as an overall", () => {
    // The column rule is "any row carries one", so a row the report counted
    // but never percentaged must hold the column up beside fully-stated rows.
    expect(carriesOverall(student(90))).toBe(true);
    expect(
      carriesOverall({
        ...student(90),
        overallPct: null,
        overallAttendedOfHeld: "10/20",
      })
    ).toBe(true);
    expect(
      carriesOverall({
        ...student(90),
        overallPct: null,
        overallAttendedOfHeld: "",
      })
    ).toBe(false);
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
  test("student names print capitalised, not as ECAP shouts them", () => {
    // ECAP states names in all caps; the register prints them the way a
    // person writes them. Lower-cased first, because CSS capitalise leaves
    // all-caps input untouched.
    expect(displayName("ADARI LASYA SHREE")).toBe("Adari Lasya Shree");
    expect(displayName("A STUDENT")).toBe("A Student");
    expect(displayName("")).toBe("");
  });
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
    expect(registerRows(roster, NO_FILTER, false).map((s) => s.roll)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
  test("the Portal's order survives the irregular filter's membership", () => {
    // Filtering drops rows; it does not invent rows. A is healthy and must not
    // appear just because the other two are being sorted.
    expect(
      registerRows(roster, irregularOnly, false)
        .map((s) => s.roll)
        .toSorted()
    ).toEqual(["B", "C"]);
  });
  test("ticking the box sorts the students by attendance, worst first", () => {
    // The filtered table exists to be worked through: the student who most needs a
    // check-in should be the first one reached. That is the whole reason to sort,
    // and it is why this is a separate case from the unfiltered table.
    expect(
      registerRows(roster, irregularOnly, false).map((s) => s.roll)
    ).toEqual(["C", "B"]);
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
      registerRows([mildOverall, worstOverall], irregularOnly, true).map(
        (s) => s.roll
      )
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
      registerRows([unknownFigure, ...roster], irregularOnly, false).map(
        (s) => s.roll
      )
    ).toEqual(["C", "B", "U"]);
  });
  test("a student only the all-subjects view can judge is left to it", () => {
    // U is Irregular across the section and has no subject figure at all — a dash
    // in the column this table leads with. Admitting them to a subject worklist
    // would put a row in it that nothing on screen explains. The All subjects view
    // shows the band that admits them, and that is where they are kept.
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
      registerRows([noSubjectFigure, ...roster], irregularOnly, false).map(
        (s) => s.roll
      ),
      "a subject register shows no overall figure to judge them on"
    ).toEqual(["C", "B"]);
    expect(
      registerRows([noSubjectFigure, ...roster], irregularOnly, true).map(
        (s) => s.roll
      ),
      "and the section-wide view is where that band is read"
    ).toEqual(["U"]);
  });
  test("the caller's array is never sorted in place", () => {
    const input = [...roster];
    registerRows(input, NO_FILTER, false);
    registerRows(input, irregularOnly, false);
    expect(input.map((s) => s.roll)).toEqual(["A", "B", "C"]);
  });
  test("each ticked bar names how many rows it alone would keep", () => {
    // B is irregular on the subject figure but healthy overall; C is the
    // reverse. Counting per bar through the path's own figure keeps the two
    // views distinct instead of agreeing by accident.
    const mixed = [
      { ...student(90), sl: "1", roll: "A", name: "A" },
      {
        ...student(70),
        sl: "2",
        roll: "B",
        name: "B",
        overallPct: 80,
        overallIrregular: false,
        overallCritical: false,
      },
      {
        ...student(40),
        sl: "3",
        roll: "C",
        name: "C",
        overallPct: 30,
        overallIrregular: true,
        overallCritical: true,
      },
    ];
    expect(barCounts(mixed, "", true)).toEqual({
      irregular: 1,
      below75: 1,
      below65: 1,
    });
    expect(barCounts(mixed, "", false)).toEqual({
      irregular: 2,
      below75: 2,
      below65: 1,
    });
    expect(barCounts(mixed, "c", true)).toEqual({
      irregular: 1,
      below75: 1,
      below65: 1,
    });
  });
});
