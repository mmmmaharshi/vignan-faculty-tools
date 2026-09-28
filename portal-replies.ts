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

import type { Option, Student } from "./shared/api";

/** A parsed register row, before the irregular/critical flags are attached. */
export type RegisterRow = Omit<Student, "irregular" | "critical">;

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
      .replaceAll(/\\(['"\\])/g, "$1")
      .replaceAll("\\r", "\r")
      .replaceAll("\\n", "\n");
  }
  return t;
}

/**
 * Read a `<select>` fragment into options.
 *
 * `unknown` on purpose: this is the one function every convention-A payload
 * passes through, and that payload is untyped by design. See `#jq` in server.ts.
 */
export function options(html: unknown): Option[] {
  const out: Option[] = [];
  for (const m of String(html ?? "").matchAll(
    /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
  )) {
    const attrs = m[1] ?? "";
    const pick = (n: string): string =>
      attrs.match(new RegExp(`${n}\\s*=\\s*'([^']*)'`, "i"))?.[1] ??
      attrs.match(new RegExp(`${n}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ??
      "";
    const label = (m[2] ?? "")
      .replaceAll(/<[^>]*>/g, "")
      .replaceAll("&nbsp;", " ")
      .replaceAll(/\s+/g, " ")
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
  o.value === "0" || /^-?\s*select\s*-?$/i.test(o.label);

export const realOptions = (list: Option[]): Option[] =>
  list.filter((o) => !isPlaceholder(o));

/**
 * Options for a level that cannot legitimately be empty.
 *
 * Checked against every branch and semester the portal offers — twelve
 * combinations — and no level has ever come back empty. Subjects are not scoped
 * to a section, so the twelve cover those too. The one thing not covered is a
 * course this account cannot see, because the portal offers it only one.
 *
 * So an empty list means the reply was not the markup we asked for. The message
 * names both plausible causes rather than assuming, because from here they are
 * indistinguishable.
 *
 * If this is ever wrong the cost is a 502 where the user previously got an empty
 * dropdown. That is a worse symptom, and the message is what makes it
 * diagnosable rather than baffling.
 */
export function expectLevel(list: Option[], what: string): Option[] {
  if (!list.length) {
    throw new HttpError(
      502,
      `ECAP returned no ${what}. The portal's layout may have changed, or the session may have expired - sign in again and try again.`
    );
  }
  return list;
}

/** Strip tags and collapse whitespace, for table scraping. */
export function cellText(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll(/\s+/g, " ")
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
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const head = cellText((t.match(/<tr[\s\S]*?<\/tr>/i) ?? [""])[0] ?? "");
    if (/roll\s*\.?\s*no/i.test(head)) {
      table = t;
      break;
    }
  }
  if (!table) return [];

  const rows: RegisterRow[] = [];
  for (const tr of (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).slice(1)) {
    const cells = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (m) => cellText(m[1] ?? "")
    );
    if (cells.length < 4) continue;
    const roll = cells[1] ?? "";
    if (!roll) continue;
    const attendedOfHeld = cells.at(-2) ?? "";
    const pct = cells.at(-1) ?? "";
    const num = Number.parseFloat(String(pct).replace("%", ""));
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
  for (const tag of html.match(/<input[^>]*>/gi) ?? []) {
    if (new RegExp(`name="${name}"`, "i").test(tag)) {
      return tag.match(/value="([^"]*)"/i)?.[1] ?? "";
    }
  }
  return "";
}
