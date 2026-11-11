import { parsePortalDate, statedStartDate } from "../../shared/portal-values";
import { readStoredString, writeStoredString } from "../data/storage";

export type Range = { from: string; to: string };
/** A dd/mm/yyyy Portal date as the `yyyy-mm-dd` a date input takes. */
export function toPortalDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}
export function toInputDate(portal: string): string {
  if (!portal) return "";
  const [d, m, y] = portal.split("/");
  if (!d || !m || !y) return "";
  return `${y}-${m}-${d}`;
}
/** The window a register request asked for, in the shape the date inputs hold. */
export function rangeOfRequest(request: { from: string; to: string }): Range {
  return { from: toInputDate(request.from), to: toInputDate(request.to) };
}
/**
 * The register's own first day as an input date, or null where it states none
 * or it falls outside the window asked for. The rule itself lives in
 * `shared/api.ts` beside the other Portal date vocabulary, because the server
 * resolves the same day for the summary; this is only the ISO edge.
 */
export function statedStartIso(
  dates: readonly string[],
  range: Range
): string | null {
  const stated = statedStartDate(dates, {
    from: toPortalDate(range.from),
    to: toPortalDate(range.to),
  });
  return stated ? toInputDate(stated) : null;
}
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
export function defaultRange(now: Date = new Date()): Range {
  return {
    to: isoDay(now),
    from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
  };
}
const START_KEY = "range-from";
/**
 * The portal has no semester start date to give, so the only way to find one is
 * for a person to widen the range until the figures stop growing. Remember the
 * date they settled on, and open there from then on.
 *
 * Only the start is kept. The end is always today: a remembered `to` would open
 * the app on last month's numbers, which is the failure this exists to avoid.
 */
export function rememberRangeStart(from: string): void {
  if (!from) return;
  writeStoredString(START_KEY, from);
}
/** Opens the window at `iso`, unless it already opens there, and remembers
 *  it so the next visit starts at the semester rather than at the month. The
 *  one writer of `range.from` on a stated start: the settle-time snaps and
 *  the just-loaded register both come through here. */
export function openRangeAt(
  iso: string,
  range: Range,
  setRange: (update: (r: Range) => Range) => void
): void {
  if (!iso || iso === range.from) return;
  rememberRangeStart(iso);
  setRange((r) => ({ ...r, from: iso }));
}
export function startingRange(now: Date = new Date()): Range {
  const fallback = defaultRange(now);
  const saved = readStoredString(START_KEY);
  return saved ? { from: saved, to: fallback.to } : fallback;
}
/**
 * Calendar days in a dd/mm/yyyy range, both ends counted. Null when the range
 * will not parse, so the facts stay bare rather than printing nonsense.
 */
export function calendarDays(from: string, to: string): number | null {
  const start = parsePortalDate(from);
  const end = parsePortalDate(to);
  if (!start || !end) return null;
  // UTC, so a daylight-saving hour cannot make one day 23 or 25 hours long.
  const startAt = Date.UTC(start.year, start.month - 1, start.day);
  const endAt = Date.UTC(end.year, end.month - 1, end.day);
  if (endAt < startAt) return null;
  return Math.round((endAt - startAt) / 86_400_000) + 1;
}
