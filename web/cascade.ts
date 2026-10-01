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
 * The saved unit is a Section, not a Subject: attendance is recorded per Subject,
 * so a Section taught three subjects has three averages and three different
 * denominators. Four values are stored and nothing else — no subject, no dates —
 * and never a label, because labels are rebuilt from the cascade and a stored one
 * would display a class name ECAP has since renamed.
 *
 * The key is scoped by user id, so a shared machine does not offer one person's
 * class to the next. localStorage is per-browser, so it does not follow anyone to
 * another machine, and that was the trade taken knowingly.
 */
const SECTION_KEY_PREFIX = "section-";
/** Course, Semester, Branch, Section — the levels a saved section is made of. */
const SECTION_LEVELS = ["course", "semester", "branch", "section"] as const;
export function rememberSection(userId: string, sel: Sel): void {
  if (!userId) return;
  if (SECTION_LEVELS.some((key) => !sel[key])) return;
  const values = Object.fromEntries(
    SECTION_LEVELS.map((key) => [key, sel[key]])
  );
  try {
    localStorage.setItem(
      `${SECTION_KEY_PREFIX}${userId}`,
      JSON.stringify(values)
    );
  } catch {
    /* a refused write must not break the screen */
  }
}
export function savedSection(userId: string): Sel | null {
  if (!userId) return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(`${SECTION_KEY_PREFIX}${userId}`);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const values = parsed as Record<string, unknown>;
  const read = (key: (typeof SECTION_LEVELS)[number]): string => {
    const value = values[key];
    return typeof value === "string" ? value : "";
  };
  const section: Sel = {
    course: read("course"),
    semester: read("semester"),
    branch: read("branch"),
    section: read("section"),
    subject: "",
  };
  return SECTION_LEVELS.every((key) => section[key]) ? section : null;
}
export function forgetSection(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(`${SECTION_KEY_PREFIX}${userId}`);
  } catch {
    /* a refused delete must not break the screen */
  }
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
