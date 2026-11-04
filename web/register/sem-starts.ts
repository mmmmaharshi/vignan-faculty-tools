import { classKey } from "./saved-classes";
import { readStringMap, writeStringMap } from "./string-map-store";

/** The earliest held days seen, per class: class key to dd/mm/yyyy. Portal data,
 *  not personal data, so — unlike saved classes — it is not scoped by user id
 *  and it survives sign-out with the next user. */
export type SemStarts = Record<string, string>;
const STARTS_KEY = "sem-starts";
/** A class plus its batch: the semester value alone can repeat next year, but
 *  the Portal's own batch title ("2025") does not, so a new year starts a new
 *  memory instead of inheriting last year's start. */
export function semStartKey(
  values: Record<string, string>,
  semesterTitle: string
): string {
  return `${classKey(values)} ${semesterTitle}`.trim();
}
const code = (date: string): number => {
  const [d, m, y] = date.split("/").map(Number);
  if (!d || !m || !y || d > 31 || m > 12) return Number.NaN;
  return y * 10_000 + m * 100 + d;
};
const valid = (date: string): boolean => !Number.isNaN(code(date));
export function readSemStarts(): SemStarts {
  return readStringMap(STARTS_KEY, valid);
}
export function writeSemStarts(starts: SemStarts): void {
  writeStringMap(STARTS_KEY, starts);
}
/**
 * Fold one register's first day into the memory: the earliest day ever seen
 * for the class wins, so a later narrow window never moves the start forward.
 * Pure over the map it is given, so the earliest-seen rule is pinnable without
 * storage; the caller persists the returned map when it changes.
 */
export function noteSemStart(
  prev: SemStarts,
  key: string,
  stated: string | null
): SemStarts {
  if (!key || !stated || !valid(stated)) return prev;
  const cur = prev[key];
  if (cur && code(cur) <= code(stated)) return prev;
  return { ...prev, [key]: stated };
}
