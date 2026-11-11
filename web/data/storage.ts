/**
 * One localStorage walk for every memory the app keeps, in the three shapes the
 * memories take: a map of values read with a validator, one JSON value of any
 * shape read with a guard, and one bare string. Six memories use it — the
 * semester starts, the saved sections, the dashboard view, the range start, the
 * period hours and today's timetable — and differ in what they keep and in how
 * a value is judged, never in how a failure is handled: a refused read answers
 * absent, and a refused write leaves the screen alone.
 */
export function readStringMap(
  key: string,
  valid: (value: string) => boolean
): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && valid(entry[1])
      )
    );
  } catch {
    return {};
  }
}
export function writeStringMap(key: string, map: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* a refused write must not break the screen */
  }
}
/**
 * One localStorage value of any JSON shape: read with a guard, written whole.
 * The string maps above are the multi-entry memories; this is the single-value
 * one — same walk, so the storage failure rules live once rather than once
 * per memory.
 */
export function readStored<T>(
  key: string,
  valid: (value: unknown) => value is T
): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a refused write must not break the screen */
  }
}
/** One localStorage string, kept as the bare string it was written as: the
 *  range start predates the JSON memories and a stored format is not worth
 *  migrating for a convenience. The failure rules are the ones above. */
export function readStoredString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function writeStoredString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a refused write must not break the screen */
  }
}
