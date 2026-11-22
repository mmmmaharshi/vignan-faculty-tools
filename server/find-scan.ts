/**
 * The Student Search section scan, as named outcomes. The roll is looked for
 * section by section; once found the scan stops, and if every section refuses
 * with no answer the caller owes a portal failure rather than a "no row" note.
 */
import type { Option } from "../shared/api.js";

export type SectionRead<T> =
  | { kind: "answered"; section: Option; row: T | null }
  | { kind: "refused"; error: unknown };

export type SectionScan<T> =
  | { kind: "scanning"; answered: boolean; failure: unknown }
  | { kind: "found"; section: Option; row: T }
  | { kind: "unanswered" }
  | { kind: "no-row" }
  | { kind: "refused"; error: unknown };

export const startScan = <T>(): SectionScan<T> => ({
  kind: "scanning",
  answered: false,
  failure: null,
});

/** A found roll ends the scan. Any later section is ignored. */
export function scanStep<T>(
  scan: SectionScan<T>,
  read: SectionRead<T>
): SectionScan<T> {
  if (scan.kind !== "scanning") {
    return scan;
  }
  if (read.kind === "answered") {
    return read.row
      ? { kind: "found", section: read.section, row: read.row }
      : { kind: "scanning", answered: true, failure: scan.failure };
  }
  return {
    kind: "scanning",
    answered: scan.answered,
    failure: scan.failure ?? read.error,
  };
}

/** Closes the loop: an answer without the roll outranks a refusal beside it. */
export function endScan<T>(scan: SectionScan<T>): SectionScan<T> {
  if (scan.kind !== "scanning") {
    return scan;
  }
  if (scan.answered) {
    return { kind: "no-row" };
  }
  return scan.failure
    ? { kind: "refused", error: scan.failure }
    : { kind: "unanswered" };
}
