import type { RegisterReply, Student } from "./shared/api";

export const IRREGULAR_BELOW = 75;
export const CRITICAL_BELOW = 60;
/**
 * What the portal stated for one student's attendance across every subject in
 * the section. The attended-of-held half is carried as the portal wrote it and
 * is never split; see CONTEXT.md.
 */
export interface OverallFigure {
  attendedOfHeld: string;
  pct: number | null;
}
export type OverallLookup = ReadonlyMap<string, OverallFigure>;
export type RegisterRow = Omit<
  Student,
  | "irregular"
  | "critical"
  | "overallPct"
  | "overallAttendedOfHeld"
  | "overallIrregular"
  | "overallCritical"
>;
type Band = ReturnType<typeof band>;
const isBelow = (b: Band): boolean => b === "Irregular" || b === "Critical";
export function band(
  pct: number | null
): "Regular" | "Irregular" | "Critical" | null {
  if (pct == null) return null;
  if (pct < CRITICAL_BELOW) return "Critical";
  return pct < IRREGULAR_BELOW ? "Irregular" : "Regular";
}
/**
 * The portal writes the two halves attended-first, as `381\481`. The column is
 * labelled the other way round, so they are shown in the reader's order. Nothing
 * is computed from them: the figure the bands are applied to still arrives whole
 * from the portal's own percentage cell, and these two are never added,
 * divided or compared. See ADR 0017.
 */
export function overallCellForDisplay(cell: string): string {
  const halves = cell.split("\\");
  if (halves.length < 2) return cell;
  return `${halves[1]} / ${halves[0]}`;
}
export function withBands(
  row: RegisterRow,
  overall: OverallFigure | null = null
): Student {
  const subjectBand = band(row.pct);
  const overallBand = band(overall?.pct ?? null);
  return {
    ...row,
    overallPct: overall?.pct ?? null,
    overallAttendedOfHeld: overall?.attendedOfHeld ?? "",
    irregular: isBelow(subjectBand),
    critical: subjectBand === "Critical",
    overallIrregular: isBelow(overallBand),
    overallCritical: overallBand === "Critical",
  };
}
const oneDecimal = (total: number, n: number): number | null =>
  n ? Math.round((total / n) * 10) / 10 : null;
export function summarise(
  rows: readonly RegisterRow[],
  range: { from: string; to: string },
  overall: OverallLookup = new Map()
): { students: Student[]; summary: RegisterReply["summary"] } {
  const students: Student[] = [];
  let irregular = 0;
  let critical = 0;
  let counted = 0;
  let sum = 0;
  let overallIrregular = 0;
  let overallCritical = 0;
  let overallCounted = 0;
  let overallSum = 0;
  for (const row of rows) {
    const s = withBands(row, overall.get(row.roll) ?? null);
    students.push(s);
    if (s.irregular) irregular += 1;
    if (s.critical) critical += 1;
    if (s.pct != null) {
      counted += 1;
      sum += s.pct;
    }
    if (s.overallIrregular) overallIrregular += 1;
    if (s.overallCritical) overallCritical += 1;
    if (s.overallPct != null) {
      overallCounted += 1;
      overallSum += s.overallPct;
    }
  }
  return {
    students,
    summary: {
      total: students.length,
      irregular,
      critical,
      irregularBelow: IRREGULAR_BELOW,
      criticalBelow: CRITICAL_BELOW,
      average: oneDecimal(sum, counted),
      overallAverage: oneDecimal(overallSum, overallCounted),
      overallIrregular,
      overallCritical,
      range,
    },
  };
}
