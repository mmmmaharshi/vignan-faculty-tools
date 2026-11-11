/** How many months one walk may read before it gives up. The two semester
 *  walks use it as a limit on how far back they look; the month table uses it
 *  as a limit on how many rows it will ask for. One number, because all three
 *  are answering "how far can this go before it is not a semester any more". */
export const MONTH_WALK_CAP = 12;
/** One calendar month as a portal window, dd/mm/yyyy both ends. Month shapes
 *  are the only range ECAP reliably answers — live runs show wide registers
 *  come back empty — so every walk reads month by month. */
export function monthWindow(
  year: number,
  month: number
): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  return {
    from: `01/${mm}/${year}`,
    to: `${new Date(year, month, 0).getDate()}/${mm}/${year}`,
  };
}
/** The month before, across a year boundary. */
export function previousMonth(
  year: number,
  month: number
): { year: number; month: number } {
  return month > 1 ? { year, month: month - 1 } : { year: year - 1, month: 12 };
}
/** The month after, across a year boundary. */
export function nextMonth(
  year: number,
  month: number
): { year: number; month: number } {
  return month < 12 ? { year, month: month + 1 } : { year: year + 1, month: 1 };
}
/**
 * A grid's date columns belonging to one month, in the grid's own order. Only
 * this month's own columns may name anything below: the year attached there
 * is the step's own. The comparison is numeric because the Portal is not
 * trusted to zero-pad.
 */
function datesInMonth(dates: readonly string[], month: number): string[] {
  return dates.filter((c) => Number(c.split("/")[1]) === month);
}
/** The month's own first held day as dd/mm/yyyy, or null where the grid
 *  states none of it. */
export function monthStart(
  dates: readonly string[],
  year: number,
  month: number
): string | null {
  const [day] = (datesInMonth(dates, month)[0] ?? "").split("/");
  if (!day) return null;
  const mm = String(month).padStart(2, "0");
  return `${day.padStart(2, "0")}/${mm}/${year}`;
}
