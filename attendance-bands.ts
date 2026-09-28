/**
 * The attendance bands.
 *
 * CONTEXT.md names Regular, Irregular and Critical as domain terms and rules
 * that a fourth band needs an ADR to introduce. Until now the rule that produces
 * them was anonymous code in a route body: a `map`, three `filter`s and a
 * `reduce`, thirty-one lines with no name. So the boundary between "irregular"
 * and "critical" was stated nowhere except as the literal `60` in server.ts, and
 * nothing tested it.
 *
 * This module is that boundary, in one place, with a test for every side of it.
 * It is pure and takes no arguments from the caller beyond the data, so both the
 * flags and the counts come from the same call and cannot disagree - which is
 * the failure the smoke test's stat-card assertion exists to catch, and which
 * costs a live round trip to catch.
 *
 * The thresholds are here rather than in the client because the server is what
 * applies them, and they travel to the client in the summary so the stat cards
 * are labelled from the numbers that produced the flags.
 *
 * See docs/adr/0006-give-the-attendance-bands-a-module.md.
 */

import type { RegisterReply, Student } from "./shared/api";

/** Attendance at or above this is regular. */
export const IRREGULAR_BELOW = 75;

/** Attendance below this is critical, whatever else it is. */
export const CRITICAL_BELOW = 60;

/** A register row as the portal gave it, before the bands are applied. */
export type RegisterRow = Omit<Student, "irregular" | "critical">;

/**
 * The band a percentage falls in.
 *
 * `null` - the portal's cell would not parse - is deliberately not a band. It is
 * returned as `null` rather than defaulting to `Regular`, because claiming a
 * student is fine on the strength of nothing is worse than saying nothing. The
 * row still renders, still sorts, and still appears in the total; it just is not
 * counted as anyone's problem.
 *
 * Both thresholds are `below`, so the boundaries are exact: 75 is Regular, 74.99
 * is Irregular, 60 is Irregular, 59.99 is Critical. There is no overlap and no
 * gap, which is what lets `summarise` count a student once and a reader trust the
 * number.
 */
export function band(
  pct: number | null
): "Regular" | "Irregular" | "Critical" | null {
  if (pct == null) return null;
  if (pct < CRITICAL_BELOW) return "Critical";
  return pct < IRREGULAR_BELOW ? "Irregular" : "Regular";
}

/** A row with its two flags, the only way a student reaches the client. */
export function withBands(row: RegisterRow): Student {
  const b = band(row.pct);
  return {
    ...row,
    irregular: b === "Irregular" || b === "Critical",
    critical: b === "Critical",
  };
}

/**
 * The flags and the counts, from one pass over the rows.
 *
 * The counts are derived here rather than computed by three separate `filter`s
 * at the call site, for one reason: a count that is a different traversal from
 * the flag is a count that can disagree with it, and the stat cards would then
 * say a number the table does not support. Deriving both from `band` makes that
 * impossible rather than unlikely.
 *
 * The average excludes unparseable percentages rather than treating them as
 * zero. A student whose cell would not parse is not evidence of bad attendance,
 * and averaging them in would drag the class figure down on the strength of a
 * parsing failure. `counted` is the count that went into it, so a reader can see
 * how much of the register the figure covers - there is no such student in the
 * data seen so far, which is why the field is not on screen.
 */
export function summarise(
  rows: readonly RegisterRow[],
  range: { from: string; to: string }
): { students: Student[]; summary: RegisterReply["summary"] } {
  const students: Student[] = [];
  let irregular = 0;
  let critical = 0;
  let counted = 0;
  let sum = 0;

  for (const row of rows) {
    const s = withBands(row);
    students.push(s);
    if (s.irregular) irregular += 1;
    if (s.critical) critical += 1;
    if (s.pct != null) {
      counted += 1;
      sum += s.pct;
    }
  }

  return {
    students,
    summary: {
      total: students.length,
      irregular,
      critical,
      // Sent so the client labels the cards from the same numbers that produced
      // the flags, instead of hardcoding them in two places.
      irregularBelow: IRREGULAR_BELOW,
      criticalBelow: CRITICAL_BELOW,
      // One decimal, matching what the portal itself shows. Rounded once, here,
      // so the client never has to decide.
      average: counted ? Math.round((sum / counted) * 10) / 10 : null,
      range,
    },
  };
}
