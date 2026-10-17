import { createCipheriv } from "node:crypto";

import type { CascadeLevel, Option } from "./shared/api";

export const AES_KEY = "8701661282118308";
export function portalEncrypt(plaintext: string): string {
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(AES_KEY, "utf-8"),
    Buffer.from(AES_KEY, "utf-8")
  );
  return Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]).toString("base64");
}
export const enc = (v: string | number): string =>
  String(v).replaceAll("%", "%26").replaceAll("=", "%3D");
export function jqBody(
  data: Record<string, string | number | boolean>
): string {
  const body = Object.entries(data)
    .map(
      ([k, v]) =>
        `'${k}':${typeof v === "string" ? `'${v.replaceAll("'", "\\'")}'` : v}`
    )
    .join(",");
  return `{${body}}`;
}
export function webMethodBody(pairs: [string, string | number][]): string {
  return pairs.map(([k, v]) => `${k}=${enc(v)}`).join("\r\n");
}
export function calendarPairs(
  p: Record<CascadeLevel, Option> & { from: string; to: string }
): [string, string | number][] {
  return [
    ["SubjectId", p.subject.value],
    ["Section", p.section.value],
    ["Course", p.course.value],
    ["CourseName", p.course.label],
    ["Branch", p.branch.value],
    ["BranchName", p.branch.label],
    ["Semester", p.semester.value],
    ["SemesterName", p.semester.label],
    ["SubjectShortCode", p.subject.label],
    ["SubjectType", p.subject.title ?? ""],
    ["AllowPrint", "false"],
    ["fromdate", p.from],
    ["todate", p.to],
  ];
}
/**
 * The Student Wise report's twelve values, in the order that method's own proxy
 * declares them — **lower-cased**, unlike the subject register's, and the wrong
 * case is the bare `Object of type 'System.DBNull' cannot be converted to type
 * 'System.String'` rather than an empty report. It is the one call that lays
 * per-day columns for **every** subject at once, for one student.
 */
export function studentPairs(
  roll: string,
  name: string,
  p: Record<CascadeLevel, Option> & { from: string; to: string }
): [string, string | number][] {
  return [
    ["rollNo", roll],
    ["sectionId", p.section.value],
    ["courseId", p.course.value],
    ["courseName", p.course.label],
    ["branchId", p.branch.value],
    ["branchName", p.branch.label],
    ["semesterId", p.semester.value],
    ["semesterName", p.semester.label],
    ["studentName", name],
    ["allowPrint", "false"],
    ["fromdate", p.from],
    ["todate", p.to],
  ];
}
/**
 * The Class attendance report's thirteen values, in the order its generated
 * proxy declares them. All thirteen go on every call. The report honours any
 * date range and the Portal has no semester start date to send, so the range
 * travels whole.
 */
export function classPairs(
  p: Record<CascadeLevel, Option> & { from: string; to: string }
): [string, string | number][] {
  return [
    ["courseId", p.course.value],
    ["branchId", p.branch.value],
    ["semesterId", p.semester.value],
    ["sectionId", p.section.value],
    ["fromDate", p.from],
    ["toDate", p.to],
    ["courseName", p.course.label],
    ["branch", p.branch.label],
    ["semesterName", p.semester.label],
    ["sectionName", p.section.label],
    ["isJNTUFormat", "false"],
    ["onlyhostelrs", "false"],
    ["excludeothersubjects", "false"],
  ];
}
export class CookieJar {
  readonly entries = new Map<string, string>();
  get signedIn(): boolean {
    return this.entries.has("frmAuth");
  }
  header(): string | null {
    if (!this.entries.size) return null;
    return [...this.entries].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
export function absorbSetCookie(
  jar: CookieJar,
  raw: string | null | undefined
): boolean {
  if (!raw) return false;
  const [pair] = raw.split(";");
  if (!pair) return false;
  const eq = pair.indexOf("=");
  if (eq <= 0) return false;
  const name = pair.slice(0, eq).trim();
  if (!name) return false;
  jar.entries.set(name, pair.slice(eq + 1).trim());
  return true;
}
export function absorbResponse(jar: CookieJar, res: Response): number {
  let taken = 0;
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    if (absorbSetCookie(jar, raw)) taken += 1;
  }
  return taken;
}
export function nextHop(
  res: Response,
  from: string,
  maxHops: number
): string | null {
  if (res.status < 300 || res.status >= 400) return null;
  if (maxHops <= 0) return null;
  const loc = res.headers.get("location");
  if (!loc) return null;
  return new URL(loc, from).toString();
}
