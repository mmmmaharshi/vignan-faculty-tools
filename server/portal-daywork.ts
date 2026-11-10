import type { DayWorkCell, DayWorkSection, TodayClass } from "../shared/api.js";
import { ROW, cellText, cellsOf, rawCells } from "./portal-html.js";

/** The dashboard's schedule grid: the inner table the page's own GetToDayClasses
 *  call fills. Extracted by id first, so the outer title table's rows never
 *  mix with the periods. Its absence — the cleared-evening `</table>` — is an
 *  empty day, never a failure. */
const SCHEDULE_GRID =
  /<table[^>]*\bid\s*=\s*['"]?tblschedule['"]?[^>]*>(?<grid>[\s\S]*?)<\/table>/i;
/** What separates a period's stacked lines: `<hr/>` starts a second subject
 *  sharing the period, `<br/>` separates a subject from its section. Split on
 *  the first, then the second — never one flat split paired two-by-two, which
 *  misaligns every later row the moment one entry carries an odd line count. */
const NEXT_SUBJECT = /<hr[^>]*>/gi;
const NEXT_LINE = /<br[^>]*>/gi;
/** One section's block of the day-class-work report opens with this. */
const SECTION_BLOCK = /<b>Course:<\/b>/i;
const BLOCK_BRANCH = /<b>Branch:<\/b>&nbsp;(?<branch>[^<]*)/i;
const BLOCK_SEMESTER = /<b>Semester:<\/b>&nbsp;(?<semester>[^<]*)/i;
const BLOCK_SECTION = /<b>Section:<\/b>&nbsp;(?<section>[^<]*)/i;
/** The report's Present and Absent count columns, by position: its header
 *  names them, so a reorder that moved them would silently flip postedness
 *  — which is why the positions are named once here rather than numbered at
 *  the read. */
const PRESENT_COLUMN = 5;
const ABSENT_COLUMN = 6;
/** The report's last column, headed `Roll.No's / Absent Students`: the roll
 *  numbers it lists as absent for that period, comma-separated. Measured live
 *  2026-11-10, where its entry count agreed with the `Absent` cell on every
 *  posted period checked. */
const ROLLS_COLUMN = 7;
/** A count is a number, never a dash: ECAP writes "-" where a period has
 *  not been posted, and that is not a count of zero. */
const isCount = (value: string): boolean => /^\d+$/.test(value);
/** The missing rolls the report lists, in its own order, as written. A dash is
 *  not a roll number: it is ECAP's own way of stating nothing here. */
const rollsOf = (cell: string): string[] =>
  cell
    .split(",")
    .map((roll) => roll.trim())
    .filter((roll) => roll && roll !== "-");
/**
 * ECAP's day-class-work report, one block per section: course, branch,
 * semester, section and headcount, then one row per period with the subject,
 * the staff, and the present/absent counts. Every held period states both
 * counts once posted, so a row with blank counts is not yet posted; a reply
 * with no section blocks states no classes at all, which is not the same as
 * all posted.
 */
export function parseDayClassWork(
  html: string,
  shorts: Record<string, string> = {}
): DayWorkSection[] {
  const blocks = html.split(SECTION_BLOCK).slice(1);
  const sections: DayWorkSection[] = [];
  for (const block of blocks) {
    const branch = block.match(BLOCK_BRANCH)?.groups?.branch?.trim() ?? "";
    const semester =
      block.match(BLOCK_SEMESTER)?.groups?.semester?.trim() ?? "";
    const section = block.match(BLOCK_SECTION)?.groups?.section?.trim() ?? "";
    const cells: DayWorkCell[] = [];
    for (const row of block.match(ROW) ?? []) {
      const rowCells = cellsOf(row);
      if (rowCells.length < 8 || !/^\d+$/.test(rowCells[0] ?? "")) continue;
      // A row with exactly one count still reads posted: every posted period in
      // every live reply states both, so half-blank is malformed, not unposted.
      const present = rowCells[PRESENT_COLUMN] ?? "";
      const absent = rowCells[ABSENT_COLUMN] ?? "";
      const hasPresent = isCount(present);
      const hasAbsent = isCount(absent);
      // Subject and staff travel as stated — including ECAP's own "-" where
      // a period carries no allocation yet. Only counts are normalised: a
      // dash is not a count of zero.
      cells.push({
        period: rowCells[0] ?? "",
        subject: rowCells[1] ?? "",
        posted: hasPresent || hasAbsent,
        staff: rowCells[2] ?? "",
        present: hasPresent ? present : "",
        absent: hasAbsent ? absent : "",
        // Read as written, whatever the counts say: an unposted period states
        // no rolls either, so the list is empty on its own account rather than
        // by a rule this parser imposes.
        absentRolls: rollsOf(rowCells[ROLLS_COLUMN] ?? ""),
      });
    }
    sections.push({
      branch,
      branchShort: shorts[branch] ?? branch,
      semester,
      section,
      cells,
    });
  }
  return sections;
}
/** The dashboard's schedule grid as today's periods, in the grid's own order. */
export function parseTodayClasses(html: string): TodayClass[] {
  const grid = html.match(SCHEDULE_GRID)?.groups?.grid ?? "";
  if (!grid) return [];
  const out: TodayClass[] = [];
  for (const row of grid.match(ROW) ?? []) {
    const [timeCell, stackCell] = rawCells(row);
    if (timeCell === undefined || stackCell === undefined) continue;
    // "Period-1" over its hours: the name leads bold, the hours dimmed under
    // it, so the hyphen reads better as a space. Split before the tags are
    // stripped — afterwards the break is just another space.
    const [period, ...hours] = timeCell.split(NEXT_LINE).map(cellText);
    const when = {
      period: (period ?? "").replace("-", " "),
      time: hours.join(" "),
    };
    const stacked: TodayClass[] = [];
    for (const entry of stackCell.split(NEXT_SUBJECT)) {
      const [subject, ...rest] = entry.split(NEXT_LINE).map(cellText);
      const section = rest.join(" ");
      if (subject || section) {
        stacked.push({
          period: when.period,
          time: when.time,
          subject: subject ?? "",
          section,
          room: "",
        });
      }
    }
    // The grid names every slot with its hours, free periods included — only
    // the class cell is blank. Keeping the row is what lets a blank period
    // show when it meets; dropping it left the front end guessing.
    out.push(
      ...(stacked.length
        ? stacked
        : [{ ...when, subject: "", section: "", room: "" }])
    );
  }
  return out;
}
