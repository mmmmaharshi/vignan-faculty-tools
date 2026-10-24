import type { TodayClass } from "../shared/api";
import { readStringMap, writeStringMap } from "./string-map-store";

/** How many periods an ECAP day holds: the skeleton's row count, stated once
 *  rather than wherever a loop needs it. */
export const PERIOD_COUNT = 7;
/** The last hours ECAP stated per period slot ("Period 1" → its time). A
 *  cleared day states no times at all, so the skeleton borrows these — the
 *  slots' hours, not today's classes, which stay blank. Portal data, not
 *  personal data: like the semester-start memory, it is not scoped by user
 *  id and it survives sign-out with the next user. */
export type PeriodTimes = Record<string, string>;
const TIMES_KEY = "period-times";
const nonBlank = (value: string): boolean => value.trim() !== "";
export function readPeriodTimes(): PeriodTimes {
  return readStringMap(TIMES_KEY, nonBlank);
}
export function writePeriodTimes(times: PeriodTimes): void {
  writeStringMap(TIMES_KEY, times);
}
/**
 * Fold one timetable's hours into the memory: a slot keeps the latest hours
 * ECAP stated for it. Pure over the map it is given, so the rule is pinnable
 * without storage; the caller persists the returned map when it changes.
 */
export function notePeriodTimes(
  prev: PeriodTimes,
  classes: readonly Pick<TodayClass, "period" | "time">[]
): PeriodTimes {
  const stated: PeriodTimes = {};
  let hasFresh = false;
  for (const { period, time } of classes) {
    if (!period || !time.trim()) continue;
    if (prev[period] !== time && stated[period] !== time) {
      stated[period] = time;
      hasFresh = true;
    }
  }
  return hasFresh ? { ...prev, ...stated } : prev;
}
