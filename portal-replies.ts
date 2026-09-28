/**
 * Turning portal replies into app data.
 *
 * Everything here is a pure function over a string. Nothing in this file makes a
 * network call, and nothing reads a session. That is deliberate and it is what
 * makes the guards below testable: `test/seam.spec.ts` exercises all of it
 * against fixture markup in milliseconds, with no portal and no credentials.
 *
 * The single responsibility is "bytes the portal sent, into shapes the app uses",
 * plus the error type used when a reply is not what we asked for. The HTTP side
 * of the portal - cookies, redirects, the two calling conventions - is
 * `server.ts`'s job and lives there.
 *
 * See docs/adr/0003-validate-the-portal-seam.md for why emptiness is the thing
 * worth asserting on.
 */

import type { RegisterRow } from "./attendance-bands";
import type { Option } from "./shared/api";

/**
 * A parsed register row, before the bands are applied.
 *
 * Declared in `attendance-bands.ts`, which is where the bands live and therefore
 * where this shape is consumed, and re-exported here so the parser's own
 * signature reads in one piece. Declared once, so the parser and the bander
 * cannot disagree about what a row is.
 */
export type { RegisterRow } from "./attendance-bands";

/** An HTTP failure, carrying the status to answer with. */
export class HttpError extends Error {
  /** The HTTP status to answer with. Read by the error handler in server.ts. */
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

/**
 * Whether a reply is a web page rather than the JavaScript literal we asked for.
 *
 * When the portal session dies mid-flight it can answer convention B with
 * markup instead. Undetected, that markup reaches `options()` or
 * `parseRegister()`, finds nothing, and is reported as an empty level or an empty
 * register - which is the wrong story about why.
 */
export function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

/**
 * Unwrap the portal's JavaScript-literal reply.
 *
 * Convention B answers with a bare single-quoted HTML string that the page's
 * ajax_response eval()s into {error, value}. It is not JSON, so JSON.parse on
 * it fails and the value has to be unwrapped by hand.
 *
 * The return type is `string` and this function guarantees it. It used to infer
 * `any`, because one branch handed back `JSON.parse` output untouched while both
 * callers assumed a string.
 */
export function unquoteJs(text: string): string {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j: unknown = JSON.parse(t);
      // Only a string is accepted. A number, an object or a missing key all fall
      // through to the raw text, which the callers then find no markup in.
      if (j !== null && typeof j === "object") {
        const rec = j as Record<string, unknown>;
        const payload = rec.value ?? rec.d;
        if (typeof payload === "string") return payload;
      }
      return t;
    } catch {
      /* not JSON after all */
    }
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

/**
 * Every pattern the parsers use, built once.
 *
 * These were literals inside the loops. A regex literal is a fresh object each
 * time it is evaluated, so a 63-row register was allocating on the order of
 * 1,300 of them per load - `cellText` alone runs three per call, and it is
 * called once per table cell. Hoisting them is the whole of the fix.
 *
 * Sharing a `/g` pattern is only safe for the methods that do not carry
 * `lastIndex` across calls, and that is worth stating because it is the trap:
 * `test` and `exec` advance it on a global pattern and would make every call
 * after the first start from the wrong place. Everything below is used with
 * `match`, `matchAll`, `replaceAll`, or `test` on a *non*-global pattern, all of
 * which either ignore or reset `lastIndex`. If one of these is ever switched to
 * `exec` or given a `/g` test, it has to go back inside its function.
 */
const OPTION = /<option\b(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/option>/gi;
const TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;
const PLACEHOLDER = /^-?\s*select\s*-?$/i;
const TABLE = /<table[\s\S]*?<\/table>/gi;
const FIRST_ROW = /<tr[\s\S]*?<\/tr>/i;
const ROLL_HEADER = /roll\s*\.?\s*no/i;
const ROW = /<tr[\s\S]*?<\/tr>/gi;
const CELL = /<t[dh]\b[^>]*>(?<cell>[\s\S]*?)<\/t[dh]>/gi;
const INPUT = /<input[^>]*>/gi;
const ATTRIBUTE_VALUE = /value\s*=\s*"(?<v>[^"]*)"/i;

/**
 * Attribute patterns, by name.
 *
 * `pick` used to build two `RegExp` objects per attribute per option, and it
 * runs twice per option. Only two names are ever asked for, so they are written
 * out rather than interpolated.
 */
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

/**
 * Read a `<select>` fragment into options.
 *
 * `unknown` on purpose: this is the one function every convention-A payload
 * passes through, and that payload is untyped by design. See `#jq` in server.ts.
 */
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
    // Both halves, or nothing. An entry with visible text but no identifier
    // becomes a level the user can choose that resolves to nothing, and the
    // front end reads "" as "not chosen" - so it would look selected and behave
    // unset. The portal needs both anyway: ShowAcademicCalendar takes each level
    // by value and by label.
    if (label && value) out.push({ value, title: pick("title"), label });
  }
  return out;
}

/** The "-Select-" / "Select" entry is a placeholder, not a real choice. */
export const isPlaceholder = (o: Option): boolean =>
  o.value === "0" || PLACEHOLDER.test(o.label);

export const realOptions = (list: Option[]): Option[] =>
  list.filter((o) => !isPlaceholder(o));

/**
 * Options for a level, and whether it came back empty.
 *
 * Every branch and semester the portal offers has been checked - twelve
 * combinations, the entire space this account can reach - and no level has ever
 * come back empty. Subjects are not scoped to a section, so those twelve cover
 * them too. The one thing the survey cannot cover is a course this account cannot
 * see, and the portal offers it exactly one.
 *
 * So an empty level is worth reporting, and this reports it rather than refusing.
 * The caller decides what to do with it. Throwing here would mean a course nobody
 * has observed could block the screen for everyone, which is a worse failure than
 * the silent one this replaced.
 */
export function level(list: Option[]): { choices: Option[]; empty: boolean } {
  return { choices: list, empty: list.length === 0 };
}

/** Strip tags and collapse whitespace, for table scraping. */
export function cellText(html: string): string {
  return html
    .replaceAll(TAG, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll(WHITESPACE, " ")
    .trim();
}

/**
 * Pull the roster out of the register table.
 *
 * The last two columns are always attended/held and the percentage, and the
 * roll number sits in column two. Percentages that will not parse are kept as
 * null rather than dropped, so a student is never silently missing from a
 * count just because one cell was odd.
 *
 * The attended/held cell is kept whole, as the string the portal sent. It is
 * never split into its two numbers, so nothing downstream may treat it as a
 * count of held classes. See CONTEXT.md, "Attended of held".
 */
export function parseRegister(html: string): RegisterRow[] {
  let table: string | null = null;
  for (const t of html.match(TABLE) ?? []) {
    const head = cellText((t.match(FIRST_ROW) ?? [""])[0] ?? "");
    if (ROLL_HEADER.test(head)) {
      table = t;
      break;
    }
  }
  if (!table) return [];

  const rows: RegisterRow[] = [];
  for (const tr of (table.match(ROW) ?? []).slice(1)) {
    const cells = [...tr.matchAll(CELL)].map((m) =>
      cellText(m.groups?.cell ?? "")
    );
    if (cells.length < 4) continue;
    const roll = cells[1] ?? "";
    if (!roll) continue;
    const attendedOfHeld = cells.at(-2) ?? "";
    const pct = cells.at(-1) ?? "";
    // Number rather than parseFloat, deliberately. parseFloat("12abc") is 12;
    // Number("12abc") is NaN, and a cell reading "12abc" is not a percentage, so
    // it belongs in the null branch below rather than being reported as 12%.
    const num = Number(String(pct).replace("%", ""));
    rows.push({
      sl: cells[0] ?? "",
      roll,
      name: cells[2] ?? "",
      attendedOfHeld,
      pct: Number.isNaN(num) ? null : num,
    });
  }
  return rows;
}

/** Read one hidden input's value out of a page, for the login POST. */
export function hiddenValue(html: string, name: string): string {
  for (const tag of html.match(INPUT) ?? []) {
    if (new RegExp(`name="${name}"`, "i").test(tag)) {
      return tag.match(ATTRIBUTE_VALUE)?.groups?.v ?? "";
    }
  }
  return "";
}
