import type { RegisterRow } from "./attendance-bands";
import type {
  Option,
  StudentPhone,
  StudentProfile,
  StudentSgpa,
} from "./shared/api";

export type { RegisterRow } from "./attendance-bands";
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
const cellsOf = (row: string): string[] =>
  [...row.matchAll(CELL)].map((m) => cellText(m.groups?.cell ?? ""));
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
/* A real day and month, never 0: an empty range's grid heads its one column
 * "0/0", and counting that as a class day would state one day where the Portal
 * held none. */
const DATE_CELL = /^(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])$/;
/**
 * The dates the Portal lists across the register's own grid: one column per
 * day the subject met, holidays and Sundays simply absent. The count is the
 * official working-days figure for the range — calendar arithmetic misaligns
 * the moment a holiday falls inside, so it is read, never subtracted. A grid
 * whose headers state no dates yields nothing rather than a wrong count.
 */
export function registerDates(html: string): string[] {
  return (
    firstHeaded(gridTables(html))?.[0]?.filter((c) => DATE_CELL.test(c)) ?? []
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
  };
}
export function hiddenValue(html: string, name: string): string {
  for (const tag of html.match(INPUT) ?? []) {
    if (new RegExp(`name="${name}"`, "i").test(tag)) {
      return tag.match(ATTRIBUTE_VALUE)?.groups?.v ?? "";
    }
  }
  return "";
}
