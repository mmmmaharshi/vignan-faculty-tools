/**
 * The attendance bands, tested with no portal and no browser.
 *
 * CONTEXT.md calls Regular, Irregular and Critical domain terms and rules that a
 * fourth band needs an ADR to introduce. The rule producing them was anonymous
 * code in a route body, so these boundaries were stated nowhere except as the
 * literal `60` and `75` that implemented them.
 *
 * Every case is a property of the rule - where the line sits, and what must
 * never happen across it - rather than a restatement of how it is computed.
 */

import { test, expect } from "@playwright/test";

import {
  band,
  CRITICAL_BELOW,
  IRREGULAR_BELOW,
  summarise,
  withBands,
} from "../attendance-bands";
import type { RegisterRow } from "../attendance-bands";

/** A row at a given percentage, with everything else filled in. */
const row = (pct: number | null, roll = "21CS001"): RegisterRow => ({
  sl: "1",
  roll,
  name: "A Student",
  attendedOfHeld: "38/45",
  pct,
});

/** A row with a distinct roll number, so ordering assertions can identify it. */
const named = (pct: number | null, roll: string): RegisterRow => ({
  ...row(pct, roll),
  name: roll,
});

const range = { from: "01/01/2026", to: "28/09/2026" };

test.describe("where the lines sit", () => {
  test("75 is regular and 74.99 is not, so nothing is in a gap", () => {
    // The thresholds are "below", not "at most". A boundary that went the other
    // way would put a student at exactly 75 in the wrong list, and would do it
    // only for the students who land exactly on it.
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
    // Two independent booleans on the wire. If critical did not imply
    // irregular, the "show only irregular" filter would hide the students who
    // most need to be seen.
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
    // `pct: null` means the portal's cell could not be read. Defaulting to
    // Regular would put an unknown student on a clean sheet; defaulting to
    // Critical would accuse them on the strength of a parsing failure.
    expect(band(null)).toBeNull();

    const unknown = withBands(row(null));
    expect(unknown.irregular).toBe(false);
    expect(unknown.critical).toBe(false);
  });

  test("still appears in the register and in the total", () => {
    // Dropping the row would hide a student who is enrolled. The row renders
    // with a dash; the band is simply unknown.
    const reply = summarise(
      [named(90, "A"), named(null, "B"), named(50, "C")],
      range
    );

    expect(reply.students).toHaveLength(3);
    expect(reply.summary.total).toBe(3);
    expect(reply.students.map((s) => s.roll)).toEqual(["A", "B", "C"]);
  });

  test("is left out of the average rather than counted as zero", () => {
    // A parsing failure is not evidence of bad attendance. Averaging it in as
    // zero would drag the class figure down and misdescribe every other
    // student in the room.
    const withNull = summarise([row(80), row(null)], range);
    expect(withNull.summary.average).toBe(80);

    // And with nobody parseable there is no average to report, not a zero.
    expect(summarise([row(null)], range).summary.average).toBeNull();
    expect(summarise([], range).summary.average).toBeNull();
  });
});

test.describe("the counts and the flags cannot disagree", () => {
  test("every irregular student is counted, and counted once", () => {
    // This is the stat card the smoke test cross-checks against the badges, at
    // the cost of a live round trip. Here it costs nothing.
    const rows = [
      named(90, "A"),
      named(74, "B"),
      named(59, "C"),
      named(45, "D"),
    ];
    const { summary } = summarise(rows, range);

    expect(summary.irregular).toBe(3); // 74, 59, 45
    expect(summary.critical).toBe(2); // 59, 45
    expect(summary.total).toBe(4);
  });

  test("critical is a subset of irregular, always", () => {
    // A count where critical exceeded irregular would mean the two were
    // computed from different traversals. That is the drift this module exists
    // to make impossible, so it is asserted rather than assumed.
    for (const pct of [0, 40, 59.99, 60, 74.99, 75, 90, 100, null]) {
      const { summary } = summarise([row(pct)], range);
      expect(summary.critical).toBeLessThanOrEqual(summary.irregular);
    }
  });

  test("an all-regular class reports zero of both, and says so in the thresholds", () => {
    // The thresholds travel with the reply so the client labels the cards from
    // the numbers that produced the flags. If these were hardcoded on the
    // client instead, a change here would silently relabel the cards.
    const { summary } = summarise([row(90), row(95)], range);
    expect(summary.irregular).toBe(0);
    expect(summary.critical).toBe(0);
    expect(summary.irregularBelow).toBe(75);
    expect(summary.criticalBelow).toBe(60);
  });

  test("the average is rounded to one decimal, once", () => {
    // 79.1666... must not reach the screen as a float, and the client must not
    // have to decide how to round it.
    const { summary } = summarise([row(79), row(79), row(80)], range);
    expect(summary.average).toBe(79.3);
  });

  test("the range comes back as it was given", () => {
    // The line above the table names the register and its dates, so a reader can
    // tell this term from last one.
    const { summary } = summarise([row(90)], range);
    expect(summary.range).toEqual(range);
  });

  test("an empty register summarises to zeros rather than throwing", () => {
    // The route already refuses an empty register with a 502, so this is the
    // function's own behaviour for a caller that does not.
    const { summary } = summarise([], range);
    expect(summary).toMatchObject({
      total: 0,
      irregular: 0,
      critical: 0,
      average: null,
    });
  });
});

test.describe("what the portal gave, preserved", () => {
  test("the combined attended/held cell is never split or reformatted", () => {
    // CONTEXT.md: it is a display string, not two numbers. Nothing may parse it
    // and nothing may normalise it, because a rewrite would invent a value the
    // portal never sent.
    const s = withBands({ ...row(84.44), attendedOfHeld: "38 / 45" });
    expect(s.attendedOfHeld).toBe("38 / 45");
  });

  test("the percentage is carried through unchanged", () => {
    // The table formats it to two decimals; the summary averages the raw value.
    // Rounding here would quietly change the class figure.
    expect(withBands(row(84.444)).pct).toBe(84.444);
  });
});
