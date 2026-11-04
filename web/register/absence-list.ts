import type { Student } from "../../shared/api";

/**
 * The absent dates the panel shows, as one list rather than two.
 *
 * The wider semester read wins when it answered. When it did not, the window's
 * own list is shown — but only if the window really is the whole semester:
 * called over a window that starts after the semester start, ECAP states just
 * that window's dates, and printing them under a "full semester" heading would
 * be a different answer than the one asked for. Null where neither has
 * anything to show, which is not a clean sheet.
 */
export function fullAbsenceList(input: {
  /** The wider read's answer, when ECAP gave one. */
  wider: string[] | undefined;
  semesterStart: string | null;
  /** Whether the window starts after the remembered start. */
  windowStartsAfterStart: boolean;
  /** The window's own dates, from the row or the Student Wise report. */
  window: string[];
}): string[] | null {
  const { wider, semesterStart, windowStartsAfterStart, window: dates } = input;
  if (wider) return wider;
  if (!semesterStart || windowStartsAfterStart) return null;
  return dates.length ? dates : null;
}

/** The window's own absent dates: the register row's cells where it has them,
 *  otherwise the Student Wise report the panel reads for this student. */
export function windowAbsenceList(
  student: Student | null,
  fromProfile: string[] | undefined
): string[] {
  if (student && student.absent.length > 0) return student.absent;
  return fromProfile ?? [];
}
