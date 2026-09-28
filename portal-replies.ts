import type { RegisterRow } from "./attendance-bands";
import type { Option } from "./shared/api";

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
const FIRST_ROW = /<tr[\s\S]*?<\/tr>/i;
const ROLL_HEADER = /roll\s*\.?\s*no/i;
const ROW = /<tr[\s\S]*?<\/tr>/gi;
const CELL = /<t[dh]\b[^>]*>(?<cell>[\s\S]*?)<\/t[dh]>/gi;
const INPUT = /<input[^>]*>/gi;
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
export function hiddenValue(html: string, name: string): string {
  for (const tag of html.match(INPUT) ?? []) {
    if (new RegExp(`name="${name}"`, "i").test(tag)) {
      return tag.match(ATTRIBUTE_VALUE)?.groups?.v ?? "";
    }
  }
  return "";
}
