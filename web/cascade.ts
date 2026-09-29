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
    if (key === "subject") {
      next.subject = "";
      continue;
    }
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
