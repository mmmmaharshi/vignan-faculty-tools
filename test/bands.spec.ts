import { test, expect } from "@playwright/test";

import {
  band,
  CRITICAL_BELOW,
  IRREGULAR_BELOW,
  summarise,
  withBands,
} from "../attendance-bands";
import type { RegisterRow } from "../attendance-bands";

const row = (pct: number | null, roll = "21CS001"): RegisterRow => ({
  sl: "1",
  roll,
  name: "A Student",
  attendedOfHeld: "38/45",
  pct,
});
const named = (pct: number | null, roll: string): RegisterRow => ({
  ...row(pct, roll),
  name: roll,
});
const range = { from: "01/01/2026", to: "28/09/2026" };
test.describe("where the lines sit", () => {
  test("75 is regular and 74.99 is not, so nothing is in a gap", () => {
    expect(IRREGULAR_BELOW).toBe(75);
    expect(band(75)).toBe("Regular");
    expect(band(74.99)).toBe("Irregular");
  });
  test("60 is irregular and 59.99 is critical", () => {
    expect(CRITICAL_BELOW).toBe(60);
    expect(band(60)).toBe("Irregular");
    expect(band(59.99)).toBe("Critical");
  });
  test("a student who is critical is also irregular, never only one", () => {
    const critical = withBands(row(40));
    expect(critical.critical).toBe(true);
    expect(critical.irregular).toBe(true);
    const irregular = withBands(row(70));
    expect(irregular.critical).toBe(false);
    expect(irregular.irregular).toBe(true);
  });
  test("100 and 0 are ordinary cases, not edges", () => {
    expect(band(100)).toBe("Regular");
    expect(band(0)).toBe("Critical");
  });
});
test.describe("a percentage that would not parse", () => {
  test("is in no band at all, and is never called a problem", () => {
    expect(band(null)).toBeNull();
    const unknown = withBands(row(null));
    expect(unknown.irregular).toBe(false);
    expect(unknown.critical).toBe(false);
  });
  test("still appears in the register and in the total", () => {
    const reply = summarise(
      [named(90, "A"), named(null, "B"), named(50, "C")],
      range
    );
    expect(reply.students).toHaveLength(3);
    expect(reply.summary.total).toBe(3);
    expect(reply.students.map((s) => s.roll)).toEqual(["A", "B", "C"]);
  });
  test("is left out of the average rather than counted as zero", () => {
    const withNull = summarise([row(80), row(null)], range);
    expect(withNull.summary.average).toBe(80);
    expect(summarise([row(null)], range).summary.average).toBeNull();
    expect(summarise([], range).summary.average).toBeNull();
  });
});
test.describe("the counts and the flags cannot disagree", () => {
  test("every irregular student is counted, and counted once", () => {
    const rows = [
      named(90, "A"),
      named(74, "B"),
      named(59, "C"),
      named(45, "D"),
    ];
    const { summary } = summarise(rows, range);
    expect(summary.irregular).toBe(3);
    expect(summary.critical).toBe(2);
    expect(summary.total).toBe(4);
  });
  test("critical is a subset of irregular, always", () => {
    for (const pct of [0, 40, 59.99, 60, 74.99, 75, 90, 100, null]) {
      const { summary } = summarise([row(pct)], range);
      expect(summary.critical).toBeLessThanOrEqual(summary.irregular);
    }
  });
  test("an all-regular class reports zero of both, and says so in the thresholds", () => {
    const { summary } = summarise([row(90), row(95)], range);
    expect(summary.irregular).toBe(0);
    expect(summary.critical).toBe(0);
    expect(summary.irregularBelow).toBe(75);
    expect(summary.criticalBelow).toBe(60);
  });
  test("the average is rounded to one decimal, once", () => {
    const { summary } = summarise([row(79), row(79), row(80)], range);
    expect(summary.average).toBe(79.3);
  });
  test("the range comes back as it was given", () => {
    const { summary } = summarise([row(90)], range);
    expect(summary.range).toEqual(range);
  });
  test("an empty register summarises to zeros rather than throwing", () => {
    const { summary } = summarise([], range);
    expect(summary).toMatchObject({
      total: 0,
      irregular: 0,
      critical: 0,
      average: null,
    });
  });
});
const figure = (pct: number | null, held = "381\\481") => ({
  attendedOfHeld: held,
  pct,
});
test.describe("the overall bands sit where the subject bands do", () => {
  test("75 is regular and 74.99 is not, on the overall figure too", () => {
    expect(withBands(row(90), figure(75)).overallIrregular).toBe(false);
    expect(withBands(row(90), figure(74.99)).overallIrregular).toBe(true);
  });
  test("60 is irregular and 59.99 is critical, on the overall figure too", () => {
    expect(withBands(row(90), figure(60)).overallCritical).toBe(false);
    expect(withBands(row(90), figure(59.99)).overallCritical).toBe(true);
  });
  test("an overall problem and a subject problem are independent", () => {
    const healthySubject = withBands(row(90), figure(74.01));
    expect(healthySubject.irregular).toBe(false);
    expect(healthySubject.critical).toBe(false);
    expect(healthySubject.overallIrregular).toBe(true);
    expect(healthySubject.overallCritical).toBe(false);
    const healthyOverall = withBands(row(40), figure(95));
    expect(healthyOverall.irregular).toBe(true);
    expect(healthyOverall.overallIrregular).toBe(false);
  });
  test("no overall figure is no overall band, and is not a zero", () => {
    const unknown = withBands(row(90));
    expect(unknown.overallPct).toBeNull();
    expect(unknown.overallIrregular).toBe(false);
    expect(unknown.overallCritical).toBe(false);
    expect(withBands(row(90), figure(null)).overallPct).toBeNull();
  });
  test("the overall combined cell is carried whole, never split", () => {
    const s = withBands(row(90), figure(79.21, "381\\481"));
    expect(s.overallAttendedOfHeld).toBe("381\\481");
  });
});
test.describe("the overall counts come from the overall figure", () => {
  test("a student the portal gave no overall figure for is left out of the average", () => {
    const lookup = new Map([
      ["A", { attendedOfHeld: "381\\481", pct: 90 }],
      ["C", { attendedOfHeld: "100\\481", pct: 50 }],
    ]);
    const { summary } = summarise(
      [named(90, "A"), named(null, "B"), named(50, "C")],
      range,
      lookup
    );
    expect(summary.overallAverage).toBe(70);
    expect(summary.total).toBe(3);
  });
  test("overall flags are counted from the overall figure, not the subject one", () => {
    const lookup = new Map([
      ["A", { attendedOfHeld: "", pct: 74 }],
      ["B", { attendedOfHeld: "", pct: 59 }],
      ["C", { attendedOfHeld: "", pct: 95 }],
    ]);
    const { summary } = summarise(
      [named(90, "A"), named(45, "B"), named(90, "C")],
      range,
      lookup
    );
    expect(summary.overallIrregular).toBe(2);
    expect(summary.overallCritical).toBe(1);
    expect(summary.irregular).toBe(1);
    expect(summary.critical).toBe(1);
  });
  test("an overall average with nobody in it is absent, not zero", () => {
    expect(
      summarise([named(90, "A")], range).summary.overallAverage
    ).toBeNull();
    expect(summarise([], range).summary.overallAverage).toBeNull();
  });
  test("the overall average is rounded to one decimal, like the subject one", () => {
    const lookup = new Map([
      ["A", { attendedOfHeld: "", pct: 79 }],
      ["B", { attendedOfHeld: "", pct: 79 }],
      ["C", { attendedOfHeld: "", pct: 80 }],
    ]);
    const { summary } = summarise(
      [named(90, "A"), named(90, "B"), named(90, "C")],
      range,
      lookup
    );
    expect(summary.overallAverage).toBe(79.3);
  });
});
test.describe("what the portal gave, preserved", () => {
  test("the combined attended/held cell is never split or reformatted", () => {
    const s = withBands({ ...row(84.44), attendedOfHeld: "38 / 45" });
    expect(s.attendedOfHeld).toBe("38 / 45");
  });
  test("the percentage is carried through unchanged", () => {
    expect(withBands(row(84.444)).pct).toBe(84.444);
  });
});
