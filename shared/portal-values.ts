/**
 * The rules the app applies when it reads a value off a Portal reply, and the
 * clock it reads dates by. Both runtimes need them and both must agree, so they
 * live outside the contract: `shared/api.ts` states the shapes the two sides
 * exchange, and this file states what those shapes mean.
 */

import type { Option } from "./api.js";
/**
 * The two attendance lines, as fractions of 100. Both halves of the app judge by
 * them: the server bands every figure with them and the client's worklist
 * filters and labels by the same numbers. A threshold changed in one place and
 * not the other would badge a student `low` under a checkbox that says they are
 * not.
 */
export const IRREGULAR_BELOW = 75;
export const CRITICAL_BELOW = 65;
/**
 * A stated percentage, or null where ECAP stated no number. A blank cell is
 * absence of evidence and `Number("")` is `0`, which is how a missing figure
 * once read as a failing student; a value above 100 is not a percentage either.
 * One rule for every reply that states a figure.
 */
export function statedPercent(cell: string): number | null {
  const stated = cell.replace("%", "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(stated)) return null;
  const num = Number(stated);
  return num <= 100 ? num : null;
}
/**
 * The register's own first date column, carried as a full dd/mm/yyyy date. The
 * grid states dd/mm only, so the year is whichever year inside the range puts
 * the day between `from` and `to`, earliest first — the portal reports the
 * first day it holds data for, which is where the figures begin. Null when the
 * grid states no dates or the range will not parse.
 *
 * Both sides need this rule and they used to keep a copy each: the server
 * resolves it for the summary, the client for the From snap when the summary
 * could not. One implementation, because they must agree on the day.
 */
export function statedStartDate(
  dates: readonly string[],
  range: { from: string; to: string }
): string | null {
  const [d, m] = (dates[0] ?? "").split("/").map(Number);
  const [fd, fm, fy] = range.from.split("/").map(Number);
  const [td, tm, ty] = range.to.split("/").map(Number);
  if (!d || !m || !fd || !fm || !td || !tm || !fy || !ty) return null;
  const code = (y: number): number => y * 10_000 + m * 100 + d;
  const low = fy * 10_000 + fm * 100 + fd;
  const high = ty * 10_000 + tm * 100 + td;
  for (let y = fy; y <= ty; y++) {
    if (code(y) >= low && code(y) <= high) {
      return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
    }
  }
  return null;
}
/**
 * The portal writes the two halves attended-first, as `381\481`. They are shown
 * in that same order with a plain slash between them, so the cell reads the way
 * the column above it is named. Nothing is computed from them: the figure the
 * bands are applied to still arrives whole from the portal's own percentage
 * cell, and these two are never added, divided or compared. See ADR 0017.
 */
export function overallCellForDisplay(cell: string): string {
  const halves = cell.split("\\");
  if (halves.length < 2) return cell;
  return `${halves[0]} / ${halves[1]}`;
}
/** The message an error carries, for the panel that shows it. Both runtimes
 *  report failures in words, so both read them the same way. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
/**
 * Whether two statements of a roll number name the same student. ECAP writes a
 * roll in caps on a report and in whatever case it was typed elsewhere, so a
 * comparison that cares about case blanks a row whose figure is right there.
 * One rule, because three readers look a roll up and all three must find the
 * same row.
 */
export const sameRoll = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
/** Today on the campus clock, dd/mm/yyyy: ECAP's dates are IST, and a server
 *  on UTC would ask for yesterday after 18:30 UTC. Pure, so both the server's
 *  ask and the client's title read the same day. */
export function todayIST(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(now);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

/** A label without the word that merely names its kind: "III Semester" and "III"
 *  are the same semester, and "Section-1" and "1" are not forced together —
 *  everything else about the comparison stays exact. */
const bareLabel = (label: string): string =>
  label
    .replaceAll(
      /\b(?:semester|section|branch|course|year|degree|programme|program)\b/gi,
      ""
    )
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
/** The option a page's own words name, or null. Value first, because the Portal's
 *  reports are asked by value rather than by label; then the label — which the
 *  class report's column header and the subject list's own label state in
 *  different words for one subject. A text that names more than one option names
 *  none of them: guessing a class reads the wrong section's register, and the
 *  figure's own label is the only sign of it. */
export function matchOption(
  text: string,
  list: readonly Option[]
): Option | null {
  const t = text.trim();
  if (!t) return null;
  const byValue = list.find(
    (o) => o.value.trim().toLowerCase() === t.toLowerCase()
  );
  if (byValue) return byValue;
  const bare = bareLabel(t);
  if (!bare) return null;
  const exact = list.filter((o) => bareLabel(o.label) === bare);
  if (exact.length === 1) return exact[0] ?? null;
  const partial = list.filter((o) => bareLabel(o.label).includes(bare));
  return partial.length === 1 ? (partial[0] ?? null) : null;
}
