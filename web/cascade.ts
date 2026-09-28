/**
 * The cascade's decision rules.
 *
 * These are the rules that were wrong three separate times before they were
 * right, and they lived inside `App.tsx` where no test could reach them - the
 * file exports one symbol, and importing it mounts React. So the file that
 * documents the traps was also the file that could not check them. This is the
 * same move `portal-replies.ts` makes for the server: the rules are pure
 * functions over plain data, so they can be tested in milliseconds with no
 * portal and no browser.
 *
 * What is NOT here, deliberately: the refresh loop, `refreshToken`, and the ref
 * pattern. Those are about ordering and staleness in time, which is `App`'s job.
 * See docs/adr/0005-give-the-cascade-rules-a-module.md.
 *
 * Environment-neutral by construction: declarations and pure functions over
 * `shared/api.ts` shapes. No DOM, no React, no globals - which is what lets the
 * test project compile this file alongside `portal-replies.ts`.
 */

import type {
  CascadeLevel,
  Option,
  OptionsReply,
  RegisterReply,
} from "../shared/api";

/** One position in the cascade, straight from the contract. */
export type Level = CascadeLevel;

/** What the user has chosen at each level. Every level is present, possibly "". */
export type Sel = Record<Level, string>;

/** The date range, as `yyyy-mm-dd` from the date inputs. */
export type Range = { from: string; to: string };

/** The full chain, in cascade order. The order is the dependency order. */
export const LEVELS: readonly (readonly [Level, string])[] = [
  ["course", "Course"],
  ["semester", "Semester"],
  ["branch", "Branch"],
  ["section", "Section"],
  ["subject", "Subject"],
];

export const LEVEL_KEYS: readonly Level[] = LEVELS.map(([k]) => k);

// Written out rather than assembled with Object.fromEntries, so adding a level to
// the contract is a compile error here until someone decides what an unset one
// looks like.
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

/* ------------------------------------------------------------------ selection */

/**
 * Merge a fresh option set into the current selection.
 *
 * This reproduces what a browser did to the old <select> elements: a value that
 * is still a valid option survives, and anything else falls to the first option,
 * because a populated select always has something selected.
 *
 * The subject is the exception, and it is the exception for a reason rather than
 * for tidiness: it decides which register loads, so quietly pre-selecting the
 * first one risks showing a faculty member the wrong roster. Every level ABOVE
 * the subject does auto-fill - see ADR 0001's Correction, which records that the
 * earlier "only single-option levels auto-fill" rule dead-ended the chain.
 */
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

/**
 * The full option behind each level's current value, or the label of the first
 * level that has none.
 *
 * `ShowAcademicCalendar` needs every level by identifier *and* by visible text,
 * and returns nothing at all rather than failing when a label is missing - so
 * this is checked once, here, instead of five times at the call site.
 */
export function chosenLevels(
  opts: OptionsReply,
  sel: Sel
): { ok: true; levels: Record<Level, Option> } | { ok: false; label: string } {
  // Sound because the loop below assigns every member of Level: LEVELS and
  // OptionsReply have the same five keys, and Level is derived from the latter.
  const levels = {} as Record<Level, Option>;
  for (const [key, label] of LEVELS) {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    if (!hit) return { ok: false, label };
    levels[key] = hit;
  }
  return { ok: true, levels };
}

/**
 * Whether every level above `key` has a choice, i.e. whether the server could
 * now answer for it.
 */
export function isReady(sel: Sel, key: Level): boolean {
  const i = LEVEL_KEYS.indexOf(key);
  return LEVEL_KEYS.slice(0, i).every((k) => !!sel[k]);
}

/**
 * Which dropdowns should be enabled, given the levels chosen above them.
 *
 * A level is enabled exactly when every level above it is chosen, which is the
 * same condition the server uses to decide what it may derive. Deriving it here
 * rather than hand-writing five booleans keeps the two in step.
 */
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

/* ------------------------------------------------------------------ the loop's decision */

/**
 * Whether the refresh should ask again after this pass.
 *
 * This predicate is the one that was wrong three times, and the failure mode is
 * a dead end rather than a crash: if the loop stops too early, the chain stops
 * populating; if it never stops, the dropdowns spin forever.
 *
 * Both conditions are needed. `gained` alone is not enough, because a pass that
 * changes nothing has nothing to gain by repeating. `pending` alone is not
 * enough, because a level can be "ready but empty" on every pass - the server
 * genuinely has nothing to give - and requiring `gained` is what stops the
 * looping in that case.
 *
 * `pending` is the deepest level that is ready but came back empty. Requiring
 * `gained` is also what makes the auto-fill above do the work: after a pass that
 * filled a section, the subject below it is ready and empty, so one more pass is
 * asked for and the subject arrives.
 */
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

/* ------------------------------------------------------------------ dates */

/** The portal wants dd/mm/yyyy. */
export function toPortalDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

/** A `Date` as `yyyy-mm-dd` in the reader's own timezone. */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The range the app opens with: this calendar year to today.
 *
 * A teaching year, not a rolling 30 days. Attendance is read against a term, and
 * a range that starts in January is the one a faculty member means by "so far".
 *
 * Built from the local date parts rather than `toISOString()`, on purpose.
 * `new Date(y, 0, 1)` is local midnight, and `toISOString` converts it to UTC,
 * so anywhere east of Greenwich the 1 January comes back as 31 December. That
 * is a one-day window at the wrong end of the calendar, and it was invisible
 * until this function had a test.
 */
export function defaultRange(now: Date = new Date()): Range {
  return {
    to: isoDay(now),
    from: isoDay(new Date(now.getFullYear(), 0, 1)),
  };
}

/* ------------------------------------------------------------------ display */

/**
 * The chosen levels as one line, so a stale read of the table is visible.
 *
 * With five dropdowns in front of you it is easy to read last term's numbers as
 * this term's, so the register names itself.
 */
export function chosenText(opts: OptionsReply, sel: Sel): string {
  return LEVELS.flatMap(([key, label]) => {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    return hit ? [`${label}: ${hit.label}`] : [];
  }).join("   ·   ");
}

/** The status word for a student, worst first. */
export function statusOf(s: RegisterReply["students"][number]): Status {
  if (s.critical) return "Critical";
  return s.irregular ? "Irregular" : "Regular";
}

/** The three attendance bands. See CONTEXT.md. */
export type Status = "Critical" | "Irregular" | "Regular";

/**
 * The row tint, reading Mantine's own colour tokens.
 *
 * `Table.Tr`'s `bg` prop is the whole mechanism - there is no custom CSS
 * anywhere in this project, so this returns a token or nothing at all.
 *
 * It lives here rather than beside the table because the CSV export needs the
 * same word, and both have to agree on which band a student is in.
 */
export function tintFor(
  s: RegisterReply["students"][number]
): string | undefined {
  if (s.critical) return "var(--mantine-color-red-light)";
  return s.irregular ? "var(--mantine-color-yellow-light)" : undefined;
}
