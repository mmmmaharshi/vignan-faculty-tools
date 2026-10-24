import type {
  LeaveStatus,
  Option,
  StudentBacklog,
  StudentBacklogSubject,
  StudentBacklogs,
  StudentPhone,
  StudentProfile,
  StudentSgpa,
  TodayClass,
  DayWorkCell,
  DayWorkSection,
} from "../shared/api.js";
import type { RegisterRow } from "./attendance-bands.js";

export type { RegisterRow } from "./attendance-bands.js";
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}
export function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function parseOrUndefined(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
export function unquoteJs(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    const j = parseOrUndefined(t);
    if (j !== undefined && j !== null && typeof j === "object") {
      const rec = j as Record<string, unknown>;
      const payload = rec.value ?? rec.d;
      if (typeof payload === "string") return payload;
    }
    return t;
  }
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t
      .slice(1, -1)
      .replaceAll(/\\(?<escaped>['"\\])/g, "$<escaped>")
      .replaceAll("\\r", "\r")
      .replaceAll("\\n", "\n");
  }
  return t;
}
const OPTION = /<option\b(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/option>/gi;
const TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;
const PLACEHOLDER = /^-?\s*select\s*-?$/i;
const TABLE = /<table[\s\S]*?<\/table>/gi;
const ROLL_HEADER = /roll\s*\.?\s*no/i;
/** The Student Wise report's own header: `Sl.No | Subject | dates …`. It is what
 *  tells that grid apart from the subject register's, whose header names Roll.No. */
const SUBJECT_HEADER = /^subject$/i;
const ROW = /<tr[\s\S]*?<\/tr>/gi;
const CELL = /<t[dh]\b[^>]*>(?<cell>[\s\S]*?)<\/t[dh]>/gi;
const INPUT = /<input[^>]*>/gi;
/** The container ECAP's StudentProfile page opens its BIO-DATA with. Its absence
 *  means the reply is not that page at all, which is a different failure from a
 *  student whose GPA the page left blank. */
const BIO_DATA = "divProfile_BioData";
const SEPARATOR = ":";
const PHONE_LABEL = /(?:phone|mobile)/i;
/** The page's own summary line: "CGPA: 5.61   Credits:16/19    48.55 %". */
const GPA_LINE =
  /CGPA:\s*(?<cgpa>\S+)\s+Credits:\s*(?<credits>\S+)(?:\s+(?<pct>[\d.]+)\s*%)?/;
/** The backlogs table's own total: "Total backlogs: 1". */
const BACKLOG_TOTAL = /Total backlogs:\s*(?<count>\d+)/i;
/** A backlogs row's first cell: the semester it is filed under. */
const BACKLOG_SEMESTER = /^(?:I|II|III|IV|V|VI|VII|VIII)\s+Semester$/i;
/** The per-semester grid: the header names its own SGPA column, the value sits
 *  on the row beginning "Grade", and the semester is named by the span above the
 *  table. */
const SGPA_HEADER = /^sgpa$/i;
const GRADE_ROW = /^grade$/i;
const SEMESTER_SPAN = /<span[^>]*>(?<semester>[^<]*semester[^<]*)<\/span>/gi;
const ATTRIBUTE_VALUE = /value\s*=\s*"(?<v>[^"]*)"/i;
const ATTRIBUTE = {
  value: {
    single: /value\s*=\s*'(?<v>[^']*)'/i,
    double: /value\s*=\s*"(?<v>[^"]*)"/i,
  },
  title: {
    single: /title\s*=\s*'(?<v>[^']*)'/i,
    double: /title\s*=\s*"(?<v>[^"]*)"/i,
  },
} as const;
type AttributeName = keyof typeof ATTRIBUTE;
export function options(html: unknown): Option[] {
  const out: Option[] = [];
  for (const m of String(html ?? "").matchAll(OPTION)) {
    const attrs = m.groups?.attrs ?? "";
    const pick = (name: AttributeName): string => {
      const p = ATTRIBUTE[name];
      return (
        attrs.match(p.single)?.groups?.v ??
        attrs.match(p.double)?.groups?.v ??
        ""
      );
    };
    const label = (m.groups?.text ?? "")
      .replaceAll(TAG, "")
      .replaceAll("&nbsp;", " ")
      .replaceAll(WHITESPACE, " ")
      .trim();
    const value = pick("value");
    if (label && value) out.push({ value, title: pick("title"), label });
  }
  return out;
}
const isPlaceholder = (o: Option): boolean =>
  o.value === "0" || PLACEHOLDER.test(o.label);
export const realOptions = (list: Option[]): Option[] =>
  list.filter((o) => !isPlaceholder(o));
export function level(list: Option[]): { choices: Option[]; empty: boolean } {
  return { choices: list, empty: list.length === 0 };
}
function cellText(html: string): string {
  return html
    .replaceAll(TAG, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll(WHITESPACE, " ")
    .trim();
}
/** A row's cells with their markup intact, beside `cellsOf`: the schedule
 *  grid's stacked lines split on their `<br/>`/`<hr/>` before the tags are
 *  stripped, so both readers share the one walk. */
const rawCells = (row: string): string[] =>
  [...row.matchAll(CELL)].map((m) => m.groups?.cell ?? "");
const cellsOf = (row: string): string[] => rawCells(row).map(cellText);
/**
 * Every table in a Portal reply, head first, as cell arrays. The one place
 * the reply's table shape is understood, so a Portal layout shift is fixed
 * once rather than once per reader.
 */
function gridTables(html: string): string[][][] {
  return (html.match(TABLE) ?? []).map((t) =>
    (t.match(ROW) ?? []).map(cellsOf)
  );
}
/** Grids whose first row is the roll-number header: the subject register. */
function firstHeaded(grids: string[][][]): string[][] | null {
  return (
    grids.find((rows) => (rows[0] ?? []).some((c) => ROLL_HEADER.test(c))) ??
    null
  );
}
/** Grids holding a roll-number header anywhere: the class attendance report,
 *  whose title and held-band rows sit above its header. */
function anyHeaded(grids: string[][][]): string[][] | null {
  return (
    grids.find((rows) =>
      rows.some((cells) => cells.some((c) => ROLL_HEADER.test(c)))
    ) ?? null
  );
}
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
/** Grids headed by a Subject column: the Student Wise report. */
function subjectHeaded(grids: string[][][]): string[][] | null {
  return (
    grids.find((rows) => (rows[0] ?? []).some((c) => SUBJECT_HEADER.test(c))) ??
    null
  );
}
/* A real day and month, never 0: an empty range's grid heads its one column
 * "0/0", and counting that as a class day would state one day where the Portal
 * held none. */
const DATE_CELL =
  /^(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:\/\d{2,4})?$/;
/**
 * The dates the Portal lists across the register's own grid: one column per
 * day the subject met, holidays and Sundays simply absent. The count is the
 * official working-days figure for the range — calendar arithmetic misaligns
 * the moment a holiday falls inside, so it is read, never subtracted. A grid
 * whose headers state no dates yields nothing rather than a wrong count.
 */
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
    const num = Number(String(pct).replace("%", ""));
    rows.push({
      sl: cells[0] ?? "",
      roll,
      name: cells[2] ?? "",
      attendedOfHeld,
      pct: Number.isNaN(num) ? null : num,
      absent: dates.filter((d) => cells[header.indexOf(d)] === "A"),
    });
  }
  return rows;
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
/** The Student Wise grid's own header row and body rows, or null when the reply
 *  is not that report at all. The one place that grid is told apart from the
 *  others, so a Portal layout shift is fixed once rather than once per reader. */
function studentWiseParts(html: string): {
  header: string[];
  body: string[][];
} | null {
  const grid = subjectHeaded(gridTables(html));
  const header = grid?.[0];
  if (!grid || !header) return null;
  return { header, body: grid.slice(1) };
}
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
export function parseClassAttendance(html: string): OverallRow[] {
  const rows: OverallRow[] = [];
  const grid = anyHeaded(gridTables(html));
  if (!grid) return rows;
  for (const cells of grid) {
    if (cells.length < 4) continue;
    const sl = cells[0] ?? "";
    const roll = cells[1] ?? "";
    if (!/^\d+$/.test(sl) || !roll) continue;
    const stated = (cells.at(-1) ?? "").replace("%", "").trim();
    const num = stated === "" ? Number.NaN : Number(stated);
    rows.push({
      sl,
      roll,
      name: cells[2] ?? "",
      attendedOfHeld: cells.at(-2) ?? "",
      pct: Number.isNaN(num) ? null : num,
    });
  }
  return rows;
}
/**
 * The SGPA the page states per semester: one table per semester, its SGPA column
 * named in that table's own header, its value on the row beginning "Grade", the
 * semester named by the span above the table.
 *
 * The value is read **by the header's column index**, not as the row's last cell,
 * because the Portal's markup never closes the Grade row: a last cell there is the
 * next row's total, which would print 16/19 where 5.61 belongs.
 */
function sgpaBySemester(html: string): StudentSgpa[] {
  const out: StudentSgpa[] = [];
  for (const table of html.matchAll(TABLE)) {
    const rows = (table[0].match(ROW) ?? []).map(cellsOf);
    const header = rows.find((cells) => cells.some((c) => SGPA_HEADER.test(c)));
    if (!header) continue;
    const column = header.findIndex((c) => SGPA_HEADER.test(c));
    const grade = rows.find((cells) => GRADE_ROW.test(cells[0] ?? ""));
    const value = grade?.[column] ?? "";
    if (!value) continue;
    let semester = "";
    for (const span of html.slice(0, table.index).matchAll(SEMESTER_SPAN)) {
      semester = span.groups?.semester?.trim() ?? semester;
    }
    out.push({ semester, value });
  }
  return out;
}
/** The subject codes in one backlogs cell: one per line, each keeping the red
 *  asterisk the page put before it. */
function backlogSubjects(raw: string): StudentBacklogSubject[] {
  const out: StudentBacklogSubject[] = [];
  for (const line of raw.split(/<br\s*\/?>/i)) {
    const text = cellText(line);
    if (!text) continue;
    const marked = text.startsWith("*");
    const code = (marked ? text.replace(/^\*\s*/, "") : text).trim();
    if (!code) continue;
    out.push({ code, marked });
  }
  return out;
}
/**
 * The backlogs ECAP's StudentProfile page lists, out of `divProfile_Backlogs`.
 *
 * The page's markup is unclosed — a data row never closes before the total row's
 * tag — so its rows cannot be read as rows. The cells are read in order instead:
 * a cell naming a semester opens a row, and the cell right after it holds that
 * semester's subjects, one per line. The page's own total ends the table.
 *
 * A page with no backlogs says so in words on one build ("Student have no
 * backlogs") and leaves the section empty on another. The words are carried in
 * `note`, because a stated absence is an answer and an empty table is not.
 *
 * A subject the page marks in red with a leading asterisk keeps the mark: the
 * page does not say what it means, so the app does not either.
 */
export function parseStudentBacklogs(html: string): StudentBacklogs {
  const div = html.match(
    /<div[^>]*id=['"]divProfile_Backlogs['"][^>]*>(?<inner>[\s\S]*?)<\/div>/i
  );
  const inner = div?.groups?.inner ?? "";
  const table = inner.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? "";
  const rows: StudentBacklog[] = [];
  let total: number | null = null;
  let current: StudentBacklog | null = null;
  let expectSubjects = false;
  for (const cell of table.matchAll(/<td[^>]*>(?<cell>[\s\S]*?)<\/td>/gi)) {
    const raw = cell.groups?.cell ?? "";
    const text = cellText(raw);
    const stated = BACKLOG_TOTAL.exec(text);
    if (stated) {
      total = Number(stated.groups?.count);
      break;
    }
    if (BACKLOG_SEMESTER.test(text)) {
      current = { semester: text, subjects: [] };
      rows.push(current);
      expectSubjects = true;
    } else if (expectSubjects && current) {
      current.subjects = backlogSubjects(raw);
      expectSubjects = false;
    }
  }
  return { rows, total, note: table ? "" : cellText(inner) };
}
/**
 * One student's GPA, semesters and phone numbers, out of ECAP's StudentProfile
 * page. The page is a label/separator/value grid — "Mobile.No", ":",
 * "7661864881" — so every row of it is read the same way, and the labels are
 * ECAP's own. A phone the page left blank is dropped rather than printed as an
 * empty line, and a number reaching the page under two labels is one number, not
 * two.
 *
 * `null` when the reply is not that page: the caller turns it into a 502, which
 * is a different thing from a student whose GPA the page states as NA.
 */
export function parseStudentProfile(html: string): StudentProfile | null {
  if (!html.includes(BIO_DATA)) return null;
  const phones: StudentPhone[] = [];
  const seen = new Set<string>();
  for (const tr of html.match(ROW) ?? []) {
    const cells = cellsOf(tr);
    for (let i = 0; i + 1 < cells.length; i++) {
      const label = cells[i] ?? "";
      const number = cells[i + 2] ?? "";
      if (cells[i + 1] !== SEPARATOR) continue;
      if (!PHONE_LABEL.test(label) || !number || seen.has(number)) continue;
      seen.add(number);
      phones.push({ label, number });
    }
  }
  const gpa = GPA_LINE.exec(cellText(html));
  return {
    cgpa: gpa?.groups?.cgpa ?? "",
    credits: gpa?.groups?.credits ?? "",
    cgpaPercent: gpa?.groups?.pct ?? "",
    sgpa: sgpaBySemester(html),
    phones,
    backlogs: parseStudentBacklogs(html),
  };
}
/** The class a StudentProfile page states, in the page's own words. Empty where
 *  the page states nothing: a field it omits is not a field to guess. */
export interface StatedClass {
  course: string;
  branch: string;
  semester: string;
  section: string;
}
/** Which `Label : Value` row is which level. The bio-data block writes the class
 *  in the same shape as the phone numbers, so the label is the only thing that
 *  says what a value means. */
const CLASS_LABELS: [keyof StatedClass, RegExp][] = [
  ["course", /\bcourse\b/i],
  ["branch", /\bbranch\b|\bdepartment\b/i],
  ["semester", /\bsemester\b|\bsem\b/i],
  ["section", /\bsection\b|\bsec\b/i],
];
export function parseStudentClass(html: string): StatedClass {
  const out: StatedClass = {
    course: "",
    branch: "",
    semester: "",
    section: "",
  };
  for (const tr of html.match(ROW) ?? []) {
    const cells = cellsOf(tr);
    if (cells[1] !== SEPARATOR) continue;
    const value = (cells[2] ?? "").trim();
    if (!value) continue;
    const key = CLASS_LABELS.find(([, pattern]) =>
      pattern.test(cells[0] ?? "")
    )?.[0];
    if (key && !out[key]) out[key] = value;
  }
  return out;
}
/** A label without the word that merely names its kind: "III Semester" and "III"
 *  are the same semester, and "Section-1" and "1" are not forced together —
 *  everything else about the comparison stays exact. */
const bareLabel = (label: string): string =>
  label
    .replaceAll(
      /\b(?:semester|section|branch|course|year|degree|programme|program)\b/gi,
      ""
    )
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
/** The option a page's own words name, or null. Value first, because the Portal's
 *  reports are asked by value rather than by label; then the label. A text that
 *  names more than one option names none of them: guessing a class reads the
 *  wrong section's register, and the figure's own label is the only sign of it. */
export function matchOption(
  text: string,
  list: readonly Option[]
): Option | null {
  const t = text.trim();
  if (!t) return null;
  const byValue = list.find(
    (o) => o.value.trim().toLowerCase() === t.toLowerCase()
  );
  if (byValue) return byValue;
  const bare = bareLabel(t);
  if (!bare) return null;
  const exact = list.filter((o) => bareLabel(o.label) === bare);
  if (exact.length === 1) return exact[0] ?? null;
  const partial = list.filter((o) => bareLabel(o.label).includes(bare));
  return partial.length === 1 ? (partial[0] ?? null) : null;
}
/** ECAP states the faculty member's name inside the `lblUser` span on
 *  main.aspx, prefixed with "Welcome ". Returns the name, or empty when the
 *  page did not state one (not logged in, or the span is empty). */
export function parseFacultyName(html: string): string {
  const m = html.match(
    /id="lblUser"[^>]*>\s*Welcome\s+(?<name>[\s\S]*?)<\/span>/i
  );
  return m?.groups?.name?.trim() ?? "";
}
/** The number at the front of a cell: the Portal never closes the Approved
 *  cell's div, so that cell reads `5</div` once the tags are stripped. */
const headNumber = (v: string) => v.match(/^\d+(?:\.\d+)?/)?.[0] ?? v;
/** The per-stage counts the APPLY-SELF page's `showLeaves` reply states: one
 *  row per leave type, headed `Leave Type | Eligible | Applied | Approved |
 *  Pending | Declined | Available`. The counts sit inside clickable divs and
 *  the first cell holds a radio button, so neither cell shape nor row shape
 *  can tell this grid apart — only its header can. */
export function parseLeaveStatus(html: string): LeaveStatus[] {
  const grid = gridTables(html).find((rows) =>
    rows.some(
      (cells) =>
        cells.includes("Leave Type") &&
        cells.includes("Applied") &&
        cells.includes("Declined")
    )
  );
  if (!grid) return [];
  return grid
    .filter(
      (cells) =>
        cells.length >= 8 &&
        (cells[1] ?? "") !== "" &&
        cells[1] !== "Leave Type"
    )
    .map((cells) => ({
      type: cells[1] ?? "",
      eligible: headNumber(cells[2] ?? ""),
      applied: headNumber(cells[3] ?? ""),
      approved: headNumber(cells[4] ?? ""),
      pending: headNumber(cells[5] ?? ""),
      declined: headNumber(cells[6] ?? ""),
      available: headNumber(cells[7] ?? ""),
    }));
}
/**
 * ECAP's day-class-work report, one block per section: course, branch,
 * semester, section and headcount, then one row per period with the subject,
 * the staff, and the present/absent counts. Every held period states both
 * counts once posted, so a row with blank counts is not yet posted; a reply
 * with no section blocks states no classes at all, which is not the same as
 * all posted.
 */
const SECTION_BLOCK = /<b>Course:<\/b>/i;
const BLOCK_BRANCH = /<b>Branch:<\/b>&nbsp;(?<branch>[^<]*)/i;
/** The report's Present and Absent count columns, by position: its header
 *  names them, so a reorder that moved them would silently flip postedness
 *  — which is why the positions are named once here rather than numbered at
 *  the read. */
const PRESENT_COLUMN = 5;
const ABSENT_COLUMN = 6;
const BLOCK_SEMESTER = /<b>Semester:<\/b>&nbsp;(?<semester>[^<]*)/i;
const BLOCK_SECTION = /<b>Section:<\/b>&nbsp;(?<section>[^<]*)/i;
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
      // Present and Absent are the report's own count columns, by position:
      // the header names them, so a reorder that moved them would silently
      // flip postedness — which is why the positions are named once in the
      // constants above rather than numbered at the read. A row with exactly
      // one count still reads posted: every posted period in every live reply
      // states both, so half-blank is malformed, not unposted.
      const present = rowCells[PRESENT_COLUMN] ?? "";
      const absent = rowCells[ABSENT_COLUMN] ?? "";
      cells.push({
        period: rowCells[0] ?? "",
        posted: present !== "" || absent !== "",
        staff: rowCells[2] ?? "",
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
    for (const entry of stackCell.split(NEXT_SUBJECT)) {
      const [subject, ...rest] = entry.split(NEXT_LINE).map(cellText);
      const section = rest.join(" ");
      if (subject || section) {
        out.push({
          period: when.period,
          time: when.time,
          subject: subject ?? "",
          section,
          room: "",
        });
      }
    }
  }
  return out;
}
export function hiddenValue(html: string, name: string): string {
  for (const tag of html.match(INPUT) ?? []) {
    if (new RegExp(`name="${name}"`, "i").test(tag)) {
      return tag.match(ATTRIBUTE_VALUE)?.groups?.v ?? "";
    }
  }
  return "";
}
