/**
 * ECAP's replies are HTML or a JavaScript literal, and these are the primitives
 * every reader of one shares: the tags that delimit a table, row, cell or
 * option, the two functions that strip markup, and the one place a table is
 * turned into cell arrays. A layout shift is fixed here once rather than once
 * per reader.
 */
const TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;
/** Exported for the one reader that walks a table by its own header. */
export const TABLE = /<table[\s\S]*?<\/table>/gi;
/** Exported for the one reader that classifies a cell by its own attributes. */
export const ROW = /<tr[\s\S]*?<\/tr>/gi;
export const CELL = /<t[dh]\b[^>]*>(?<cell>[\s\S]*?)<\/t[dh]>/gi;
const INPUT = /<input[^>]*>/gi;
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
/** The header a subject register and the class report both state. */
export const ROLL_HEADER = /roll\s*\.?\s*no/i;
/** The Student Wise report's own header: `Sl.No | Subject | dates …`. It is what
 *  tells that grid apart from the subject register's, whose header names Roll.No. */
const SUBJECT_HEADER = /^subject$/i;
/* A real day and month, never 0: an empty range's grid heads its one column
 * "0/0", and counting that as a class day would state one day where the Portal
 * held none. */
export const DATE_CELL =
  /^(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])(?:\/\d{2,4})?$/;
/** The reply is a page rather than the fragment the method answers, so the
 *  ECAP session is gone. */
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
/** The payload a generated proxy wraps its answer in: a bare string, a quoted
 *  string, or a `{value}` / `{d}` object. */
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
/** One attribute out of a tag's attribute text, single- or double-quoted. */
export function attributeOf(attrs: string, name: AttributeName): string {
  const pattern = ATTRIBUTE[name];
  return (
    attrs.match(pattern.single)?.groups?.v ??
    attrs.match(pattern.double)?.groups?.v ??
    ""
  );
}
/** A cell's text with its markup stripped. */
export function cellText(html: string): string {
  return html
    .replaceAll(TAG, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll(WHITESPACE, " ")
    .trim();
}
/** A row's cells with their markup intact, beside `cellsOf`: a grid whose cells
 *  stack lines on `<br/>` needs to split before the tags are stripped. */
export const rawCells = (row: string): string[] =>
  [...row.matchAll(CELL)].map((m) => m.groups?.cell ?? "");
export const cellsOf = (row: string): string[] => rawCells(row).map(cellText);
/** Every table in a reply, head first, as cell arrays. */
export function gridTables(html: string): string[][][] {
  return (html.match(TABLE) ?? []).map((t) =>
    (t.match(ROW) ?? []).map(cellsOf)
  );
}
/** Grids whose first row is the roll-number header: the subject register. */
export function firstHeaded(grids: string[][][]): string[][] | null {
  return (
    grids.find((rows) => (rows[0] ?? []).some((c) => ROLL_HEADER.test(c))) ??
    null
  );
}
/** Grids holding a roll-number header anywhere: the class attendance report,
 *  whose title and held-band rows sit above its header. */
export function anyHeaded(grids: string[][][]): string[][] | null {
  return (
    grids.find((rows) =>
      rows.some((cells) => cells.some((c) => ROLL_HEADER.test(c)))
    ) ?? null
  );
}
/** Grids headed by a Subject column: the Student Wise report. */
export function subjectHeaded(grids: string[][][]): string[][] | null {
  return (
    grids.find((rows) => (rows[0] ?? []).some((c) => SUBJECT_HEADER.test(c))) ??
    null
  );
}
/** One hidden input's value, by name: the login form's view state. */
export function hiddenValue(html: string, name: string): string {
  for (const tag of html.match(INPUT) ?? []) {
    if (new RegExp(`name="${name}"`, "i").test(tag)) {
      return attributeOf(tag, "value");
    }
  }
  return "";
}
