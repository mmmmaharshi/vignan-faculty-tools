import { statedStartDate } from "../../shared/api";
import { readStoredString, writeStoredString } from "./string-map-store";

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
  const [fd, fm, fy] = from.split("/").map(Number);
  const [td, tm, ty] = to.split("/").map(Number);
  if (!fd || !fm || !fy || !td || !tm || !ty) return null;
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  )
    return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}
