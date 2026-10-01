import type {
  CascadeLevel,
  Option,
  OptionsReply,
  RegisterReply,
} from "../shared/api";

export { isAllSubjects } from "../shared/api";

export type Level = CascadeLevel;
export type Sel = Record<Level, string>;
export type Range = { from: string; to: string };
export const LEVELS: readonly (readonly [Level, string])[] = [
  ["course", "Course"],
  ["semester", "Semester"],
  ["branch", "Branch"],
  ["section", "Section"],
  ["subject", "Subject"],
];
export const LEVEL_KEYS: readonly Level[] = LEVELS.map(([k]) => k);
export const EMPTY_SEL: Sel = {
  course: "",
  semester: "",
  branch: "",
  section: "",
  subject: "",
};
export const EMPTY_OPTS: OptionsReply = {
  course: [],
  semester: [],
  branch: [],
  section: [],
  subject: [],
  emptyLevels: [],
};
export function applyOptions(sel: Sel, opts: OptionsReply): Sel {
  const next = { ...sel };
  for (const key of LEVEL_KEYS) {
    const [first] = opts[key];
    if (!first) {
      next[key] = "";
      continue;
    }
    if (!opts[key].some((o) => String(o.value) === String(next[key]))) {
      next[key] = first.value;
    }
  }
  return next;
}
export function chosenLevels(
  opts: OptionsReply,
  sel: Sel
): { ok: true; levels: Record<Level, Option> } | { ok: false; label: string } {
  const levels = {} as Record<Level, Option>;
  for (const [key, label] of LEVELS) {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    if (!hit) return { ok: false, label };
    levels[key] = hit;
  }
  return { ok: true, levels };
}
/**
 * Which levels a changed level invalidates. Opening a saved class is the case
 * that needs the distinction: it changes the section, but it arrives carrying a
 * Subject, and clearing it below the section throws the saved one away — the
 * subject list then auto-fills to its first entry, which is ALL SUBJECTS, so the
 * card opened the section-wide view instead of the register it names.
 *
 * An empty list means nothing below is cleared: the selection arrived whole, so
 * the loop keeps it and only refetches the options for it.
 */
export function resetFor(changed: Level, arriving?: Sel): readonly Level[] {
  if (changed === "course") return ["semester", "branch", "section", "subject"];
  if (changed === "semester" || changed === "branch")
    return ["section", "subject"];
  if (changed === "section") {
    // A saved class carries its own subject; a manual pick does not.
    return arriving?.subject ? [] : ["subject"];
  }
  return [];
}
export function isReady(sel: Sel, key: Level): boolean {
  const i = LEVEL_KEYS.indexOf(key);
  return LEVEL_KEYS.slice(0, i).every((k) => !!sel[k]);
}
export function disabledLevels(sel: Sel): Record<Level, boolean> {
  const chosen = (k: Level): boolean => !!sel[k];
  return {
    course: false,
    semester: !chosen("course"),
    branch: !chosen("course"),
    section: !(chosen("course") && chosen("branch") && chosen("semester")),
    subject: !(
      chosen("course") &&
      chosen("branch") &&
      chosen("semester") &&
      chosen("section")
    ),
  };
}
export function shouldContinue(
  draft: Sel,
  before: Sel,
  reply: OptionsReply
): boolean {
  const gained = LEVEL_KEYS.some((k) => draft[k] !== before[k]);
  const pending = LEVEL_KEYS.find(
    (k) => k !== "course" && isReady(draft, k) && reply[k].length === 0
  );
  return gained && !!pending;
}
export function toPortalDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
export function defaultRange(now: Date = new Date()): Range {
  return {
    to: isoDay(now),
    from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
  };
}
const START_KEY = "range-from";
/**
 * The portal has no semester start date to give, so the only way to find one is
 * for a person to widen the range until the figures stop growing. Remember the
 * date they settled on, and open there from then on.
 *
 * Only the start is kept. The end is always today: a remembered `to` would open
 * the app on last month's numbers, which is the failure this exists to avoid.
 */
export function rememberRangeStart(from: string): void {
  if (!from) return;
  try {
    localStorage.setItem(START_KEY, from);
  } catch {
    /* a refused write must not break the load */
  }
}
export function startingRange(now: Date = new Date()): Range {
  const fallback = defaultRange(now);
  let saved = "";
  try {
    saved = localStorage.getItem(START_KEY) ?? "";
  } catch {
    return fallback;
  }
  return saved ? { from: saved, to: fallback.to } : fallback;
}
/**
 * A saved class is a Subject within a Section: five values, and never a label,
 * because labels are rebuilt from the cascade and a stored one would display a
 * class name ECAP has since renamed. No date is stored — the range belongs to
 * the register, not to the class, and a remembered `to` would open the app on
 * last month's numbers.
 *
 * Storing the Subject means one card per subject taught, which is what the user
 * asked for: opening one fills all five levels and lands on that Subject's
 * register. It is a different trade from ADR 0016's one-card-per-section, and
 * the cost is that three subjects in one section are three cards differing only
 * in their last value. That is deliberate, not an oversight.
 *
 * The key is scoped by user id, so a shared machine does not offer one person's
 * classes to the next. localStorage is per-browser, so it does not follow anyone
 * to another machine.
 */
const CLASS_KEY_PREFIX = "section-";
/** All five levels: a saved class names the register it opens. */
const CLASS_LEVELS = [
  "course",
  "semester",
  "branch",
  "section",
  "subject",
] as const;
/** The identity of a saved class: the five levels in a fixed order, so two saves
 *  of the same class compare equal without depending on key order. */
const classKey = (values: Record<string, string>): string =>
  CLASS_LEVELS.map((key) => values[key]).join(" ");
/** A stored entry becomes a class only if all five levels are strings. Anything
 *  else is dropped rather than half-read. */
function readClass(value: unknown): Sel | null {
  if (typeof value !== "object" || value === null) return null;
  const values = value as Record<string, unknown>;
  const read = (key: (typeof CLASS_LEVELS)[number]): string => {
    const found = values[key];
    return typeof found === "string" ? found : "";
  };
  const cls: Sel = {
    course: read("course"),
    semester: read("semester"),
    branch: read("branch"),
    section: read("section"),
    subject: read("subject"),
  };
  return CLASS_LEVELS.every((key) => cls[key]) ? cls : null;
}
function writeClasses(userId: string, list: readonly Sel[]): void {
  try {
    localStorage.setItem(`${CLASS_KEY_PREFIX}${userId}`, JSON.stringify(list));
  } catch {
    /* a refused write must not break the screen */
  }
}
export function savedClasses(userId: string): Sel[] {
  if (!userId) return [];
  let raw: string | null;
  try {
    raw = localStorage.getItem(`${CLASS_KEY_PREFIX}${userId}`);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // A single object is what an earlier build stored, and it is still offered.
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set<string>();
  const list: Sel[] = [];
  for (const entry of entries) {
    const cls = readClass(entry);
    if (!cls) continue;
    const key = classKey(cls);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(cls);
  }
  return list;
}
export function rememberClass(userId: string, sel: Sel): void {
  if (!userId) return;
  const cls = readClass(sel);
  if (!cls) return;
  // Re-saving moves the class to the front rather than duplicating it: the one
  // just used is the one most likely to be wanted again.
  const kept = savedClasses(userId).filter(
    (existing) => classKey(existing) !== classKey(cls)
  );
  writeClasses(userId, [cls, ...kept]);
}
export function forgetClass(userId: string, sel: Sel): void {
  if (!userId) return;
  const cls = readClass(sel);
  if (!cls) return;
  writeClasses(
    userId,
    savedClasses(userId).filter(
      (existing) => classKey(existing) !== classKey(cls)
    )
  );
}
export function chosenText(opts: OptionsReply, sel: Sel): string {
  return LEVELS.flatMap(([key, label]) => {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    return hit ? [`${label}: ${hit.label}`] : [];
  }).join("   ·   ");
}
export function tintFor(
  s: RegisterReply["students"][number]
): string | undefined {
  if (s.critical) return "var(--mantine-color-red-light)";
  return s.irregular ? "var(--mantine-color-yellow-light)" : undefined;
}
/**
 * `Show only irregular` keeps a student who is in trouble in whichever band the
 * table is actually showing. Reading the Subject band on the All subjects path
 * hid the very student the overall column was added to expose: healthy in the
 * one Subject you happened to open, critical across the section.
 */
export function visibleStudents(
  students: readonly RegisterReply["students"][number][],
  onlyIrregular: boolean,
  overallMode: boolean
): RegisterReply["students"][number][] {
  if (!onlyIrregular) return [...students];
  return students.filter((s) =>
    overallMode ? s.overallIrregular : s.overallIrregular || s.irregular
  );
}
