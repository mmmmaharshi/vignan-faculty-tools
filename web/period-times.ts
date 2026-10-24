/** The last hours ECAP stated per period slot ("Period 1" → its time). A
 *  cleared day states no times at all, so the skeleton borrows these — the
 *  slots' hours, not today's classes, which stay blank. Portal data, not
 *  personal data: like the semester-start memory, it is not scoped by user
 *  id. */
export type PeriodTimes = Record<string, string>;
const TIMES_KEY = "period-times";
export function readPeriodTimes(): PeriodTimes {
  try {
    const raw = localStorage.getItem(TIMES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim() !== ""
      )
    );
  } catch {
    return {};
  }
}
export function writePeriodTimes(times: PeriodTimes): void {
  try {
    localStorage.setItem(TIMES_KEY, JSON.stringify(times));
  } catch {
    /* a refused write must not break the screen */
  }
}
/**
 * Fold one timetable's hours into the memory: a slot keeps the latest hours
 * ECAP stated for it. Pure over the map it is given, so the rule is pinnable
 * without storage; the caller persists the returned map when it changes.
 */
export function notePeriodTimes(
  prev: PeriodTimes,
  classes: readonly { period: string; time: string }[]
): PeriodTimes {
  const stated: PeriodTimes = {};
  let fresh = 0;
  for (const { period, time } of classes) {
    if (!period || !time.trim()) continue;
    if (prev[period] !== time && stated[period] !== time) {
      stated[period] = time;
      fresh += 1;
    }
  }
  return fresh ? { ...prev, ...stated } : prev;
}
