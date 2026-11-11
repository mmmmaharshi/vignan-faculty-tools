import type {
  StudentBacklog,
  StudentBacklogSubject,
  StudentBacklogs,
  StudentPhone,
  StudentProfile,
  StudentSgpa,
  StudentSubjectGrade,
} from "../shared/api.js";
import { ROW, TABLE, cellText, cellsOf } from "./portal-html.js";

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
    // The subject codes head the same table and the Grade row marks each one,
    // so the pairs between the leading blank and the trailing SGPA are the
    // semester's own subject grades. Sliced by the header's length: the
    // unclosed Grade row carries the Credit row's cells after its own.
    const subjects: StudentSubjectGrade[] = [];
    for (let i = 1; i < header.length - 1; i++) {
      const code = (header[i] ?? "").trim();
      if (!code) continue;
      subjects.push({ code, grade: (grade?.[i] ?? "").trim() });
    }
    out.push({ semester, value, subjects });
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
