import { isAllSubjects } from "../../shared/api";
import type { CascadeLevel, Option, OptionsReply } from "../../shared/api";
import { calendarDays } from "./range";
import type { Range } from "./range";

export { isAllSubjects } from "../../shared/api";

export type Level = CascadeLevel;
export type Sel = Record<Level, string>;
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
  // One cast, and the loop is what earns it: every level is checked before any
  // is returned, so `levels` is total by the time it leaves. Building
  // `Record<Level, Option>` five times by hand would restate LEVELS.
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
/**
 * The selection a change leaves behind: the change applied, and the levels
 * `resetFor` says it invalidates cleared to empty. Applied before the Portal is
 * asked, so the screen shows the clear rather than a selection the new options
 * may not contain.
 *
 * `arriving` is the whole selection a change came *with* — a saved class being
 * opened — and is absent for a change made by hand, which is what tells the two
 * apart: only an arriving selection has the subject the section change was for.
 */
export function selectionAfter(
  seed: Sel,
  changed: Level | null,
  arriving?: Sel
): Sel {
  const cleared = changed ? resetFor(changed, arriving) : [];
  if (!cleared.length) return seed;
  const next = { ...seed };
  for (const key of cleared) next[key] = "";
  return next;
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
/**
 * A subject name's identity within a session: the section it was offered in, and
 * its own value. A subject code is short and repeats across branches, so a key of
 * the value alone hands a card the name of the same code in a different section.
 * This is display-only and never stored, so nothing here outlives the session.
 */
export function subjectNameKey(section: string, subject: string): string {
  return `${section} ${subject}`;
}
/**
 * A selection's identity within a session: the five values joined, for guards
 * that must tell one selection from another even where two selections resolve
 * to one memory key (ALL SUBJECTS and its first subject). One join, so the
 * shape cannot drift per call site.
 */
export function selKeyOf(sel: Sel): string {
  return LEVEL_KEYS.map((key) => sel[key]).join("|");
}
/**
 * The subject a semester-start probe reads: the chosen one, or the first
 * offered subject where ALL SUBJECTS stands in — the report on screen states
 * no dates, so one concrete grid stands in for the section. Null where the
 * section offers no subject at all, which is what keeps the probe honest.
 */
export function probeSubject(
  subjects: Option[],
  subject: Option
): Option | null {
  return isAllSubjects(subject)
    ? (subjects.find((o) => !isAllSubjects(o)) ?? null)
    : subject;
}
/**
 * The semester's batch title (`2025`) for a selection, or "" where the
 * semester names nothing: the Portal wants the title beside the value as the
 * batch number. One lookup, so the memory key cannot drift per call site.
 */
export function semesterTitleOf(opts: OptionsReply, semester: string): string {
  return opts.semester.find((o) => String(o.value) === semester)?.title ?? "";
}
export type ChosenFact = { label: string; value: string };
const dayWord = (n: number): string => (n === 1 ? "day" : "days");
export function chosenFacts(
  opts: OptionsReply,
  sel: Sel,
  tail?: {
    /** The window the figures on screen cover. */
    range?: Range;
    /** Days the subject met in it, as the Portal counted them. */
    classesHeld?: number | null;
    /** The register's own first day, where it stated one. */
    statedFrom?: string | null;
    /** The earliest start day known for the class, which can predate the
     *  window. Named on its own row. */
    semStart?: string | null;
  }
): ChosenFact[] {
  const { range, classesHeld, statedFrom, semStart } = tail ?? {};
  const facts = LEVELS.flatMap(([key, label]) => {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    return hit ? [{ label, value: hit.label }] : [];
  });
  // The period is part of naming the register: the card above it and
  // a student's panel state the same facts, so it is written once here. The
  // start is the register's own first date where the Portal stated one — it
  // holds nothing before the semester began, so that is where the figures
  // begin, and the From input says the same thing. The frame count travels
  // beside the label only where the Portal stated its days, never calendar
  // arithmetic for the figure itself.
  if (facts.length && range?.from) {
    const from = statedFrom || range.from;
    const total = calendarDays(from, range.to);
    if (classesHeld == null || total == null) {
      facts.push({ label: "Date Range", value: `${from} to ${range.to}` });
    } else {
      facts.push({
        label: `Date Range (${total} ${dayWord(total)})`,
        value: `${from} to ${range.to}`,
      });
    }
    // The earliest start day known for the class, which can predate the window
    // this register covers: the row keeps naming the original start even when
    // a later From is asked for. Only stated when one is known — a missing
    // memory is not a missing semester.
    if (semStart) {
      facts.push({ label: "Sem Start Date", value: semStart });
    }
  }
  return facts;
}
