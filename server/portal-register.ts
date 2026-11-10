import type { StudentTotals } from "../shared/api.js";
import { statedPercent } from "../shared/portal-values.js";
import type { RegisterRow } from "./attendance-bands.js";
import {
  CELL,
  DATE_CELL,
  ROLL_HEADER,
  ROW,
  anyHeaded,
  cellText,
  firstHeaded,
  gridTables,
  subjectHeaded,
} from "./portal-html.js";

/** The dates the Portal lists across the register's own grid: one column per
 *  day the subject met, holidays and Sundays simply absent. The count is the
 *  official working-days figure for the range — calendar arithmetic misaligns
 *  the moment a holiday falls inside, so it is read, never subtracted. A grid
 *  whose headers state no dates yields nothing rather than a wrong count. */
export function registerDates(html: string): string[] {
  return (
    firstHeaded(gridTables(html))?.[0]
      ?.filter((c) => DATE_CELL.test(c))
      .map((c) => c.split("/").slice(0, 2).join("/")) ?? []
  );
}
export function parseRegister(html: string): RegisterRow[] {
  const grid = firstHeaded(gridTables(html));
  if (!grid) return [];
  const [header] = grid;
  if (!header) return [];
  const rows: RegisterRow[] = [];
  const dates = header.filter((c) => DATE_CELL.test(c));
  for (const cells of grid.slice(1)) {
    if (cells.length < 4) continue;
    const roll = cells[1] ?? "";
    if (!roll) continue;
    const attendedOfHeld = cells.at(-2) ?? "";
    const pct = cells.at(-1) ?? "";
    rows.push({
      sl: cells[0] ?? "",
      roll,
      name: cells[2] ?? "",
      attendedOfHeld,
      pct: statedPercent(pct),
      // A subject register states one subject: its per-subject breakdown
      // lives on the class report alone, read beside it.
      subjects: [],
      absent: dates.filter((d) => cells[header.indexOf(d)] === "A"),
    });
  }
  return rows;
}
/** The Student Wise grid's own header row and body rows, or null when the reply
 *  is not that report at all. */
function studentWiseParts(html: string): {
  header: string[];
  body: string[][];
} | null {
  const grid = subjectHeaded(gridTables(html));
  const header = grid?.[0];
  if (!grid || !header) return null;
  return { header, body: grid.slice(1) };
}
/**
 * The dates one student was absent, unioned over every subject, out of ECAP's
 * Student Wise report: one row per subject, one column per day the section met,
 * and a cell holding one mark per period that day, so any `A` in it is that date
 * missed. The union is what the panel shows, in the grid's own date order.
 *
 * `null` when the reply is not that report — which is not a clean sheet, so the
 * caller states nothing rather than claiming no absences.
 */
export function parseStudentAbsences(html: string): string[] | null {
  const parts = studentWiseParts(html);
  if (!parts) return null;
  const { header } = parts;
  const body = parts.body.filter((cells) => /^\d+$/.test(cells[0] ?? ""));
  const absent: string[] = [];
  for (const date of header.filter((c) => DATE_CELL.test(c))) {
    const column = header.indexOf(date);
    if (body.some((cells) => /\bA\b/.test(cells[column] ?? ""))) {
      absent.push(date);
    }
  }
  return absent;
}
/** The meeting days a Student Wise grid states across its own header, in the
 *  grid's order — the section's days, not one student's absences. The month
 *  walk reads the start off these, so a clean month still counts as met. */
export function studentWiseDates(html: string): string[] {
  const parts = studentWiseParts(html);
  if (!parts) return [];
  return parts.header
    .filter((c) => DATE_CELL.test(c))
    .map((c) => c.split("/").slice(0, 2).join("/"));
}
export interface OverallRow {
  sl: string;
  roll: string;
  name: string;
  attendedOfHeld: string;
  pct: number | null;
}
interface SubjectRow {
  roll: string;
  pct: number | null;
}
/**
 * The subject columns the class attendance report states across its own
 * header, in order — the names a per-subject breakdown is read under. Empty
 * where the report aggregates without stating any, which is not a failure.
 */
export function classReportSubjects(html: string): string[] {
  const grid = anyHeaded(gridTables(html));
  const header =
    grid?.find((row) => row.some((c) => ROLL_HEADER.test(c))) ?? [];
  return header.slice(3, -2);
}
/** The class attendance report's rows: one per student, the figure read as the
 *  report's own last cell. */
export function parseClassAttendance(html: string): OverallRow[] {
  const rows: OverallRow[] = [];
  const grid = anyHeaded(gridTables(html));
  if (!grid) return rows;
  for (const cells of grid) {
    if (cells.length < 4) continue;
    const sl = cells[0] ?? "";
    const roll = cells[1] ?? "";
    if (!/^\d+$/.test(sl) || !roll) continue;
    rows.push({
      sl,
      roll,
      name: cells[2] ?? "",
      attendedOfHeld: cells.at(-2) ?? "",
      pct: statedPercent(cells.at(-1) ?? ""),
    });
  }
  return rows;
}
/**
 * One student's stated percentage for one subject, out of that subject's own
 * report. That report is the class report's grid under another head, so the
 * walk is the class report's: a row shape change lands in one place instead of
 * two that must agree.
 */
export function parseSubjectReport(html: string): SubjectRow[] {
  return parseClassAttendance(html).map(({ roll, pct }) => ({ roll, pct }));
}
/** The Cumulative student-wise register's own marks, by the colour the reply
 *  paints on each cell. The reply states that legend above its grid, so the
 *  mapping is read rather than assumed; a reply with no legend is refused
 *  instead of guessed. */
const CUMULATIVE_LEGEND =
  /background-color:\s*(?<colour>[A-Za-z#0-9]+)[\s\S]{0,240}?reportData2[^>]*>(?<label>[\s\S]{0,40}?)</gi;
const CELL_COLOUR = /background-color:\s*(?<colour>[^;'"]*)/i;
/** A colour that marks nothing: an attended cell carries none. */
const NO_COLOUR = /^(?:|white|transparent|#fff(?:fff)?)$/i;
/**
 * The held / attended / absent counts from ECAP's Cumulative student-wise
 * register — the numbers that screen prints above its day grid. Held counts the
 * periods that actually ran: attended, absent and not-entered cells. A holiday
 * or a no-class-work cell never ran, so it is not held.
 *
 * Every cell is classified by the legend the reply itself carries. A colour
 * the legend does not name — or no legend at all — is refused rather than
 * counted as attended, because a shifted legend would otherwise print a clean
 * 100% as fact. `null` is also the answer for a reply that is not this register
 * (no dated grid), which is not the same as three zeroes.
 */
export function parseCumulativeTotals(html: string): StudentTotals | null {
  const legend = new Map<string, string>();
  for (const m of html.matchAll(CUMULATIVE_LEGEND)) {
    const label = cellText(m.groups?.label ?? "");
    if (label) legend.set((m.groups?.colour ?? "").toLowerCase(), label);
  }
  if (!legend.size) return null;
  let present = 0;
  let absent = 0;
  let notEntered = 0;
  let dated = 0;
  for (const row of html.matchAll(ROW)) {
    const cells = [...row[0].matchAll(CELL)];
    if (!DATE_CELL.test(cellText(cells[0]?.groups?.cell ?? ""))) continue;
    dated += 1;
    for (const cell of cells.slice(1)) {
      const text = cellText(cell.groups?.cell ?? "");
      const colour = (cell[0].match(CELL_COLOUR)?.groups?.colour ?? "").trim();
      if (NO_COLOUR.test(colour)) {
        // An unmarked cell is an attended period; an unmarked empty cell is no
        // period at all.
        if (text) present += 1;
        continue;
      }
      const label = legend.get(colour.toLowerCase()) ?? "";
      if (!label) return null;
      if (/holiday|no class/i.test(label)) continue;
      // The two held-but-not-attended marks count even when ECAP leaves the
      // cell's text empty, which is exactly what "not entered" looks like.
      if (/absent/i.test(label)) {
        absent += 1;
      } else if (/not entered/i.test(label)) {
        notEntered += 1;
      } else {
        present += 1;
      }
    }
  }
  if (!dated) return null;
  return { held: present + absent + notEntered, attend: present, absent };
}
