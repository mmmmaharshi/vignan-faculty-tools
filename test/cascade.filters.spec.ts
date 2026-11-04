import { expect, test } from "@playwright/test";

import {
  NO_FILTER,
  cycleSubjectBar,
  emptyRegisterText,
  isFiltering,
  pruneSubjectBars,
  registerRows,
  visibleStudents,
} from "../web/worklist";
import type { RowFilter } from "../web/worklist";
import { bar, irregularOnly, student } from "./support/cascade-harness";

test.describe("one threshold per subject column", () => {
  const cols = ["MFCS", "SE"];
  const section = [
    { ...student(90), sl: "1", roll: "A", name: "A", subjects: [90, 80] },
    { ...student(70), sl: "2", roll: "B", name: "B", subjects: [70, null] },
    { ...student(40), sl: "3", roll: "C", name: "C", subjects: [null, 50] },
  ];
  test("a ticked subject column keeps only rows under it", () => {
    // A is healthy everywhere and B's MFCS is 70: the bar keeps the two
    // rows the column states a low figure for, and C's dash is not one.
    expect(
      registerRows(section, bar("MFCS", 75), true, cols).map((s) => s.roll)
    ).toEqual(["B"]);
  });
  test("ticked subject columns intersect, like the ticked bars", () => {
    const both: RowFilter = {
      ...NO_FILTER,
      subjectBars: [
        { code: "MFCS", below: 75 },
        { code: "SE", below: 75 },
      ],
    };
    // B clears SE but not MFCS, C clears neither: nobody clears both.
    expect(registerRows(section, both, true, cols)).toEqual([]);
  });
  test("a dash clears no subject bar", () => {
    // A missing figure is an absence, not a low one: B's blank SE and C's
    // blank MFCS are kept out rather than counted in.
    expect(
      registerRows(section, bar("SE", 75), true, cols).map((s) => s.roll)
    ).toEqual(["C"]);
  });
  test("a column the table does not show names no bar", () => {
    const gone: RowFilter = {
      ...NO_FILTER,
      subjectBars: [{ code: "DBMS", below: 75 }],
    };
    expect(registerRows(section, gone, true, cols).map((s) => s.roll)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(
      isFiltering(gone),
      "the bar is still set, so the table stays a worklist"
    ).toBe(true);
  });
  test("a subject bar makes the table a worklist with a name", () => {
    expect(isFiltering(bar("MFCS", 75))).toBe(true);
    expect(emptyRegisterText(bar("MFCS", 75), 75)).toBe(
      "No students below 75% in MFCS."
    );
  });
  test("a subject header cycles off, 75, 65, then off", () => {
    expect(cycleSubjectBar([], "MFCS")).toEqual([{ code: "MFCS", below: 75 }]);
    const once = cycleSubjectBar([], "MFCS");
    expect(cycleSubjectBar(once, "MFCS")).toEqual([
      { code: "MFCS", below: 65 },
    ]);
    expect(cycleSubjectBar(cycleSubjectBar(once, "MFCS"), "MFCS")).toEqual([]);
    expect(cycleSubjectBar([{ code: "SE", below: 65 }], "MFCS")).toEqual([
      { code: "SE", below: 65 },
      { code: "MFCS", below: 75 },
    ]);
  });
  test("settling a class drops bars for subjects it does not offer", () => {
    expect(
      pruneSubjectBars(
        [
          { code: "MFCS", below: 75 },
          { code: "SE", below: 65 },
        ],
        ["MFCS", "UHV"]
      )
    ).toEqual([{ code: "MFCS", below: 75 }]);
    expect(pruneSubjectBars([], ["MFCS"])).toEqual([]);
  });
});

test.describe("searching the roster", () => {
  const named = [
    { ...student(90), sl: "1", roll: "21CS001", name: "Anitha Reddy" },
    { ...student(70), sl: "2", roll: "21CS002", name: "Bharath Kumar" },
    { ...student(40), sl: "3", roll: "21CS003", name: "Anitha Rao" },
  ];
  test("a name fragment keeps every student carrying it, worst first", () => {
    // A search filters, so the table is a worklist and reads worst first —
    // the same rule as every other ticked box, not a second ordering.
    const filter: RowFilter = { ...NO_FILTER, search: "anitha" };
    expect(registerRows(named, filter, false).map((s) => s.roll)).toEqual([
      "21CS003",
      "21CS001",
    ]);
  });
  test("a roll fragment matches too, whatever its case", () => {
    // Rolls are typed as remembered — upper, lower, or mixed — so the match
    // cannot care about case. Names are shown upper-cased on screen, which is
    // why the name side is read lower-cased on both halves as well.
    const roll: RowFilter = { ...NO_FILTER, search: "21cs002" };
    expect(registerRows(named, roll, false).map((s) => s.roll)).toEqual([
      "21CS002",
    ]);
    const upper: RowFilter = { ...NO_FILTER, search: "ANITHA" };
    expect(registerRows(named, upper, false).map((s) => s.roll)).toEqual([
      "21CS003",
      "21CS001",
    ]);
  });
  test("a blank search filters nothing", () => {
    // Spaces are not a search: clearing the box back to blank must hand back
    // the whole roster in the Portal's own order, not an empty table.
    const blank: RowFilter = { ...NO_FILTER, search: "   " };
    expect(registerRows(named, blank, false).map((s) => s.roll)).toEqual([
      "21CS001",
      "21CS002",
      "21CS003",
    ]);
  });
  test("no match says what was asked for", () => {
    const miss: RowFilter = { ...NO_FILTER, search: "xyz" };
    expect(registerRows(named, miss, false)).toEqual([]);
    expect(emptyRegisterText(miss, 65)).toBe('No students match "xyz".');
  });
});

test.describe("show only irregular", () => {
  /** A student the two paths judge differently: healthy in the Subject, Critical
   *  across the Section. */
  const subjectCleanOverallBad = {
    ...student(90),
    overallPct: 58,
    overallIrregular: true,
    overallCritical: true,
  };
  test("each path keeps the student its own band flags", () => {
    // The Subject register's table shows no overall figure at all, so the overall
    // band is not read there; All subjects is the view that shows it, so it is
    // read there. One of the two has to be chosen, and it is the band on screen:
    // a row kept for a band the table does not show is a row with no explanation.
    expect(
      visibleStudents([subjectCleanOverallBad], irregularOnly, false),
      "a subject register cannot show why this student is in the list"
    ).toEqual([]);
    expect(
      visibleStudents([subjectCleanOverallBad], irregularOnly, true).map(
        (s) => s.roll
      ),
      "All subjects is the view the overall band belongs to"
    ).toEqual(["21CS001"]);
  });
  test("on the All subjects path the overall band is what is read", () => {
    const healthySubject = { ...student(40), overallPct: 95 };
    expect(
      visibleStudents([healthySubject], irregularOnly, true),
      "a Subject problem does not make an overall problem"
    ).toEqual([]);
  });
  test("a student in neither band is always filtered out", () => {
    expect(visibleStudents([student(90)], irregularOnly, false)).toEqual([]);
    expect(visibleStudents([student(90)], irregularOnly, true)).toEqual([]);
  });
  test("the filter is off by default, and keeps the healthy alongside the bad", () => {
    const roster = [student(90), subjectCleanOverallBad];
    expect(visibleStudents(roster, NO_FILTER, false)).toHaveLength(2);
    expect(visibleStudents(roster, NO_FILTER, true)).toHaveLength(2);
  });
  test("the boundary is the band's own, and no threshold is invented here", () => {
    const exactlySeventyFive = {
      ...student(75),
      irregular: false,
      overallPct: 75,
      overallIrregular: false,
    };
    expect(visibleStudents([exactlySeventyFive], irregularOnly, false)).toEqual(
      []
    );
    expect(visibleStudents([exactlySeventyFive], irregularOnly, true)).toEqual(
      []
    );
  });
});

test.describe("fixed thresholds", () => {
  /* Same descending roster as above: 90, 70, 40. Below 75 keeps B and C and
   * sorts them worst first; below 65 keeps only C. */
  const roster = [
    { ...student(90), sl: "1", roll: "A" },
    { ...student(70), sl: "2", roll: "B" },
    { ...student(40), sl: "3", roll: "C" },
  ];
  const below75: RowFilter = { ...NO_FILTER, below75: true };
  const below65: RowFilter = { ...NO_FILTER, below65: true };
  test("below 75 keeps the strugglers and still sorts worst first", () => {
    expect(registerRows(roster, below75, false).map((s) => s.roll)).toEqual([
      "C",
      "B",
    ]);
  });
  test("below 65 is the stricter bar", () => {
    expect(registerRows(roster, below65, false).map((s) => s.roll)).toEqual([
      "C",
    ]);
  });
  test("the fixed bars read the figure the table is showing", () => {
    // Overall figures 81, 52, 30 on healthy subject rows: the bar follows the
    // mode like the sort does, and it reads figures, not band flags.
    const overallRoster = [
      { ...student(90), sl: "1", roll: "A", overallPct: 81 },
      { ...student(90), sl: "2", roll: "B", overallPct: 52 },
      { ...student(90), sl: "3", roll: "C", overallPct: 30 },
    ];
    expect(
      registerRows(overallRoster, below65, true).map((s) => s.roll)
    ).toEqual(["C", "B"]);
  });
  test("ticked bars intersect: a flag alone clears no fixed bar", () => {
    // Flagged irregular at 80%: the irregular box alone keeps them, but 80 is
    // not below 75, so both boxes together keep nobody.
    const flaggedHealthy = { ...student(80), irregular: true };
    expect(
      visibleStudents([flaggedHealthy], irregularOnly, false).map((s) => s.roll)
    ).toEqual(["21CS001"]);
    expect(
      visibleStudents(
        [flaggedHealthy],
        { ...NO_FILTER, irregular: true, below75: true },
        false
      )
    ).toEqual([]);
  });
  test("a missing figure clears no fixed bar", () => {
    const unknownFigure = {
      ...student(70),
      sl: "1",
      roll: "U",
      pct: null,
      overallPct: null,
    };
    expect(visibleStudents([unknownFigure], below75, false)).toEqual([]);
    expect(visibleStudents([unknownFigure], below65, false)).toEqual([]);
  });
  test("the overall figure is not a stand-in for a missing subject one", () => {
    // The subject path shows a dash where the subject figure is absent, so a row
    // admitted by its overall figure would show a dash and nothing explaining it.
    // The All subjects view shows that figure, so there the same bar keeps them.
    const overallOnly = {
      ...student(70),
      sl: "1",
      roll: "U",
      pct: null,
      irregular: false,
      overallPct: 50,
      overallIrregular: true,
    };
    expect(visibleStudents([overallOnly], below75, false)).toEqual([]);
    expect(
      visibleStudents([overallOnly], below75, true).map((s) => s.roll)
    ).toEqual(["U"]);
  });
  test("the boundary is strict: 75 is not below 75", () => {
    expect(visibleStudents([student(75)], below75, false)).toEqual([]);
  });
  test("an empty register names the bar the reader set", () => {
    expect(
      emptyRegisterText(
        { ...NO_FILTER, irregular: true, below75: true, below65: true },
        65
      )
    ).toBe("No students below 65%.");
    expect(emptyRegisterText(below75, 65)).toBe("No students below 75%.");
    expect(emptyRegisterText(irregularOnly, 65)).toBe(
      "No irregular students. Everyone is at or above 65%."
    );
    expect(emptyRegisterText(NO_FILTER, 65)).toBe(
      "No students in this register."
    );
  });
  test("an empty worklist names the search and the bar together", () => {
    expect(emptyRegisterText({ ...below75, search: "xyz" }, 65)).toBe(
      'No students matching "xyz" below 75%.'
    );
    expect(emptyRegisterText({ ...irregularOnly, search: "xyz" }, 65)).toBe(
      'No irregular students matching "xyz".'
    );
  });
});
