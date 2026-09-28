import type { RegisterReply, Student } from "./shared/api";

export const IRREGULAR_BELOW = 75;
export const CRITICAL_BELOW = 60;
export type RegisterRow = Omit<Student, "irregular" | "critical">;
export function band(
  pct: number | null
): "Regular" | "Irregular" | "Critical" | null {
  if (pct == null) return null;
  if (pct < CRITICAL_BELOW) return "Critical";
  return pct < IRREGULAR_BELOW ? "Irregular" : "Regular";
}
export function withBands(row: RegisterRow): Student {
  const b = band(row.pct);
  return {
    ...row,
    irregular: b === "Irregular" || b === "Critical",
    critical: b === "Critical",
  };
}
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
      irregularBelow: IRREGULAR_BELOW,
      criticalBelow: CRITICAL_BELOW,
      average: counted ? Math.round((sum / counted) * 10) / 10 : null,
      range,
    },
  };
}
