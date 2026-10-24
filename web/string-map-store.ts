/**
 * One localStorage map of strings to strings: read with a validator, written
 * whole. The semester-start memory and the period-hours memory are both one
 * of these — the only thing differing is what counts as a keepable value —
 * so the storage walk lives once rather than once per memory.
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
