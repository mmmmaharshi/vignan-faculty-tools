import { isAllSubjects } from "../shared/api";
import type {
  CascadeLevel,
  Option,
  OptionsReply,
  OptionsRequest,
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
 * One run of the option loop, with every request it makes and everything it
 * settled. The loop is the caller's because the chain is sequential: a pass is
 * built from the reply to the pass before it, so no cache can compute it ahead.
 */
export type CascadeOutcome = {
  sel: Sel;
  opts: OptionsReply;
  /** Every subject name this run was offered, keyed as `subjectNameKey` writes
   *  them. The session's own labels, which beat a name stored at save time. */
  names: Map<string, string>;
};
export type CascadeSetup = {
  /** The selection to settle, already cleared by `selectionAfter`. */
  seed: Sel;
  /** The options the screen already holds. One thing a level's own value cannot
   *  state is the semester's title, which the Portal wants beside it as the batch
   *  number, so a run that starts with a semester chosen reads it here. */
  known: OptionsReply;
  /** Aborted when the screen stops wanting this run — a newer change, or a session
   *  that ended. The run then stops asking the Portal and answers null. */
  signal?: AbortSignal;
};
/**
 * Settles the cascade: asks for options until a pass gains nothing and no level
 * below a chosen one is still empty, and answers the selection, the last reply,
 * and the subject names it was offered.
 *
 * The fetcher is an argument rather than an import so the loop can be driven
 * without a server, the way `createApi` takes its way of reaching ECAP. It is
 * never given `signal`: an aborted run stops *between* passes, so nothing here
 * rejects with an abort the caller would have to tell apart from a failure.
 */
export async function runCascade(
  setup: CascadeSetup,
  fetchOptions: (request: OptionsRequest) => Promise<OptionsReply>
): Promise<CascadeOutcome | null> {
  const { seed, known, signal } = setup;
  let draft = { ...seed };
  let opts = known;
  const names = new Map<string, string>();
  for (const _pass of LEVEL_KEYS) {
    if (signal?.aborted) return null;
    const semesterTitle = draft.semester
      ? opts.semester.find((o) => String(o.value) === String(draft.semester))
          ?.title
      : undefined;
    const before = draft;
    const reply = await fetchOptions({
      course: draft.course || undefined,
      semester: draft.semester || undefined,
      semesterTitle,
      branch: draft.branch || undefined,
      section: draft.section || undefined,
    });
    if (signal?.aborted) return null;
    for (const option of reply.subject) {
      if (isAllSubjects(option)) continue;
      names.set(
        subjectNameKey(draft.section, String(option.value)),
        option.label
      );
    }
    draft = applyOptions(draft, reply);
    opts = reply;
    if (!shouldContinue(draft, before, reply)) break;
  }
  return { sel: draft, opts, names };
}
export function toPortalDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}
export function toInputDate(portal: string): string {
  if (!portal) return "";
  const [d, m, y] = portal.split("/");
  if (!d || !m || !y) return "";
  return `${y}-${m}-${d}`;
}
/** Resolve a dd/mm (or dd/mm/yyyy) date list's first entry to a full ISO date,
 *  but only when it falls inside the chosen range. Mirrors statedStartDate in
 *  attendance-bands.ts so the client can snap even if the server could not
 *  resolve it (e.g. an unrecognised header shape). */
export function statedStartDate(
  dates: readonly string[],
  range: { from: string; to: string }
): string | null {
  const [d, m] = (dates[0] ?? "").split("/").map(Number);
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  if (!d || !m || !fy || !fm || !fd || !ty || !tm || !td) return null;
  const code = (y: number): number => y * 10_000 + m * 100 + d;
  const low = fy * 10_000 + fm * 100 + fd;
  const high = ty * 10_000 + tm * 100 + td;
  for (let y = fy; y <= ty; y++) {
    if (code(y) >= low && code(y) <= high) {
      return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
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
export type ChosenFact = { label: string; value: string };
const dayWord = (n: number): string => (n === 1 ? "day" : "days");
/**
 * Calendar days in a dd/mm/yyyy range, both ends counted. Null when the range
 * will not parse, so the facts stay bare rather than printing nonsense.
 */
function calendarDays(from: string, to: string): number | null {
  const [fd, fm, fy] = from.split("/").map(Number);
  const [td, tm, ty] = to.split("/").map(Number);
  if (!fd || !fm || !fy || !td || !tm || !ty) return null;
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start
  )
    return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}
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
