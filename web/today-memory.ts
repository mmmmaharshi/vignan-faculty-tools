import type { TodayClass } from "../shared/api";

/**
 * Today's timetable as last read with periods still in it, and the campus day
 * it belongs to. ECAP clears the day after ~4pm, so without this an evening
 * visit reads "No Classes Today" for a day that had them. Portal data, not
 * personal data, so it survives sign-out with the next user, like the period
 * hours. One slot: yesterday's table is useless after midnight, when the date
 * stops matching and the memory is ignored.
 */
export type TodayMemory = { date: string; classes: TodayClass[] } | null;
const MEMORY_KEY = "today-classes";
const isEntry = (entry: unknown): entry is TodayClass => {
  if (typeof entry !== "object" || entry === null) return false;
  const row = entry as Record<string, unknown>;
  return ["period", "time", "subject", "section", "room"].every(
    (key) => typeof row[key] === "string"
  );
};
export function readTodayMemory(): TodayMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { date, classes } = parsed as { date?: unknown; classes?: unknown };
    if (
      typeof date !== "string" ||
      !Array.isArray(classes) ||
      classes.length === 0
    )
      return null;
    if (!classes.every(isEntry)) return null;
    return { date, classes };
  } catch {
    return null;
  }
}
export function writeTodayMemory(memory: Exclude<TodayMemory, null>): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    /* a refused write must not break the screen */
  }
}
/**
 * Fold one timetable read into the memory: a read stating periods replaces
 * it, and a cleared evening — no periods at all — keeps what the day already
 * taught. Pure over the memory it is given, so both rules are pinnable
 * without storage; the caller persists the returned map when it changed.
 */
export function noteTodayMemory(
  prev: TodayMemory,
  date: string,
  classes: readonly TodayClass[]
): TodayMemory {
  if (!date || classes.length === 0) return prev;
  return { date, classes: [...classes] };
}
/**
 * The table the screen shows: the fresh read where it states periods, else
 * the memory where it names today — the cleared-evening answer must not
 * replace the day's own table, and yesterday's must not survive midnight. A
 * read still in flight (null) stays unread rather than flashing the memory.
 * Pure, so the midnight rule is pinnable without storage.
 */
export function shownToday(
  fresh: TodayClass[] | null,
  memory: TodayMemory,
  date: string
): TodayClass[] | null {
  if (fresh && fresh.length > 0) return fresh;
  if (fresh !== null && memory?.date === date) return memory.classes;
  return fresh;
}
