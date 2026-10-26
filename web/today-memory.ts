import { useEffect, useState } from "react";

import type { TodayClass } from "../shared/api";
import { todayIST } from "../shared/api";
import { useTodayClasses } from "./client";
import { readStored, writeStored } from "./string-map-store";

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
const isMemory = (value: unknown): value is Exclude<TodayMemory, null> => {
  if (typeof value !== "object" || value === null) return false;
  const { date, classes } = value as { date?: unknown; classes?: unknown };
  return (
    typeof date === "string" &&
    Array.isArray(classes) &&
    classes.length > 0 &&
    classes.every(isEntry)
  );
};
export function readTodayMemory(): TodayMemory {
  return readStored(MEMORY_KEY, isMemory);
}
export function writeTodayMemory(memory: Exclude<TodayMemory, null>): void {
  writeStored(MEMORY_KEY, memory);
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
/**
 * Home's timetable with its memory: reads when enabled, folds each read into
 * the day's memory, and shows the memory behind a cleared evening until
 * midnight. One hook, so the read, the fold, and the display rule cannot
 * drift apart across call sites.
 */
export function useTodayTable(enabled: boolean): {
  today: ReturnType<typeof useTodayClasses>;
  todayShown: TodayClass[] | null;
} {
  const today = useTodayClasses(enabled);
  const [todayMemory, setTodayMemory] = useState<TodayMemory>(() =>
    readTodayMemory()
  );
  /* oxlint-disable react/set-state-in-effect */
  useEffect(() => {
    const classes = today.data?.classes;
    if (!classes) return;
    const day = todayIST();
    setTodayMemory((prev) => {
      const next = noteTodayMemory(prev, day, classes);
      if (next && next !== prev) writeTodayMemory(next);
      return next;
    });
  }, [today.data]);
  /* oxlint-enable react/set-state-in-effect */
  const todayShown = shownToday(
    today.data?.classes ?? null,
    todayMemory,
    todayIST()
  );
  return { today, todayShown };
}
