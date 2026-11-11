import { useEffect, useMemo } from "react";

import type { TodayClass } from "../../shared/api";
import { readStringMap, writeStringMap } from "../data/storage";

/** How many periods an ECAP day holds. The timetable and the pending-postings
 *  boxes both name every slot of this length, so the count lives once. */
export const PERIOD_COUNT = 7;
export const PERIODS: readonly string[] = Array.from(
  { length: PERIOD_COUNT },
  (_, index) => String(index + 1)
);

/**
 * The hours the timetable has ever stated for a period, by period name:
 * `Period 1` → `08:45 AM- 09:35 AM`. Portal data, not personal data, so it
 * survives sign-out with the next user. It is what lets a slot ECAP stops
 * timing — a cleared evening states no hours for anything — still read when
 * it meets.
 */
export type PeriodTimes = Record<string, string>;
const TIMES_KEY = "period-times";
/** Anything with a clock in it: the grid writes `08:45 AM- 09:35 AM`, and a
 *  remembered value that cannot be read as one is dropped rather than shown. */
const CLOCK = /\d{1,2}:\d{2}\s*[AP]M/i;
function readPeriodTimes(): PeriodTimes {
  return readStringMap(TIMES_KEY, (time) => CLOCK.test(time));
}
function writePeriodTimes(times: PeriodTimes): void {
  writeStringMap(TIMES_KEY, times);
}
/**
 * Fold one read's stated hours into the memory: a later read wins, so a period
 * that moved corrects itself, and a slot the grid left untimed never erases
 * what was already learnt. Pure over the map it is given, so both rules are
 * pinnable without storage; the caller persists the returned map when it
 * changed.
 */
export function notePeriodTimes(
  prev: PeriodTimes,
  classes: readonly TodayClass[]
): PeriodTimes {
  const next = { ...prev };
  let changed = false;
  for (const entry of classes) {
    if (!entry.period || !CLOCK.test(entry.time)) continue;
    if (next[entry.period] === entry.time) continue;
    next[entry.period] = entry.time;
    changed = true;
  }
  return changed ? next : prev;
}

/**
 * The memory as the timetable uses it: the hours every read has taught, folded
 * on each answer and written back when one taught something new. It lives here
 * rather than in the panel because the panel is presentational — its clock is
 * the only state it owns. The read is taken again inside the effect on purpose:
 * a later answer folding into a captured snapshot would erase what an earlier
 * one taught.
 */
export function usePeriodTimes(
  classes: TodayClass[] | null | undefined
): PeriodTimes {
  const known = useMemo(
    () => notePeriodTimes(readPeriodTimes(), classes ?? []),
    [classes]
  );
  useEffect(() => {
    if (!classes) return;
    const prev = readPeriodTimes();
    const next = notePeriodTimes(prev, classes);
    if (next !== prev) writePeriodTimes(next);
  }, [classes]);
  return known;
}
