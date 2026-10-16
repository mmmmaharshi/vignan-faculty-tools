import { isAllSubjects } from "../shared/api";
import type {
  CascadeLevel,
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
} from "../shared/api";

export { isAllSubjects } from "../shared/api";

export type Level = CascadeLevel;
export type Sel = Record<Level, string>;
/** A saved class: the five values that name a register, plus the Subject's label as
 *  a display cache. The label is never the answer — the cascade's own label wins
 *  whenever this session has offered the subject — so a renamed subject corrects
 *  itself the moment it is opened, and the cache only covers the cards that have
 *  not been opened yet. */
export type SavedClass = Sel & { label?: string };
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
 * A saved class is a Subject within a Section: five values, and the Subject's
 * label as a display cache. No date is stored — the range belongs to the
 * register, not to the class, and a remembered `to` would open the app on
 * last month's numbers.
 *
 * The label is a cache and never the answer: the cascade's own label wins whenever
 * this session has offered the subject, so a subject ECAP has renamed corrects
 * itself the moment its card is opened. It is stored because a card that cannot
 * name its own subject asks the user to open every card once per browser session
 * before the screen is readable, which is a worse trade than a name that is right
 * up to the moment ECAP renames it.
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
 *  else is dropped rather than half-read. A missing label is not a fault: an entry
 *  written before labels were kept still opens, it just says nothing until opened. */
function readClass(value: unknown): SavedClass | null {
  if (typeof value !== "object" || value === null) return null;
  const values = value as Record<string, unknown>;
  const read = (key: (typeof CLASS_LEVELS)[number]): string => {
    const found = values[key];
    return typeof found === "string" ? found : "";
  };
  const cls: SavedClass = {
    course: read("course"),
    semester: read("semester"),
    branch: read("branch"),
    section: read("section"),
    subject: read("subject"),
  };
  if (!CLASS_LEVELS.every((key) => cls[key])) return null;
  const { label } = values;
  if (typeof label === "string" && label) cls.label = label;
  return cls;
}
function writeClasses(userId: string, list: readonly SavedClass[]): void {
  try {
    localStorage.setItem(`${CLASS_KEY_PREFIX}${userId}`, JSON.stringify(list));
  } catch {
    /* a refused write must not break the screen */
  }
}
export function savedClasses(userId: string): SavedClass[] {
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
  const list: SavedClass[] = [];
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
export function rememberClass(userId: string, sel: Sel, label = ""): void {
  if (!userId) return;
  const cls = readClass(sel);
  if (!cls) return;
  if (label) cls.label = label;
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
const CONNECTING_WORDS = new Set(["and", "of", "the", "for", "in", "a", "to"]);
/** The initials of a phrase, or the phrase itself when it has too few words. */
function initialsOf(words: readonly string[], fallback: string): string {
  const initials = words.map((word) => word[0]?.toUpperCase() ?? "").join("");
  // A lone capital reads as a typo rather than as an abbreviation.
  return initials.length < 2 ? fallback : initials;
}
const INITIALS = /\p{L}/u;
/**
 * A long Portal label reduced to its initialism for a card: "Information
 * Technology" becomes "IT" and "Computer Science and Engineering (Artificial
 * Intelligence)" becomes "CSE(AI)" — the bracket keeps its shape and is shortened
 * inside, because that is how the Portal writes a specialisation.
 *
 * Connecting words contribute nothing, so the name reads "Computer Science and
 * Engineering" becomes "CSE" and not "CSAE". A word already inside the bracket
 * that is itself an initialism is left exactly as written, so "(CSE)" is not
 * turned into "(CS)".
 *
 * Display only. Two classes are told apart by their five values, never by the text
 * on a card, and the full name is what the dropdown says when the card is opened.
 */
export function abbreviate(name: string): string {
  const bracket = name.match(/^\s*(?<head>.*?)\s*\((?<inside>[^()]*)\)\s*$/);
  if (bracket?.groups) {
    const head = bracket.groups.head ?? "";
    const inner = bracket.groups.inside ?? "";
    const before = initialsOf(
      head
        .split(/[\s&/,-]+/)
        .filter((w) => w.length > 0 && !CONNECTING_WORDS.has(w.toLowerCase()))
        .filter((w) => INITIALS.test(w[0] ?? "")),
      head.trim()
    );
    const raw = inner.trim();
    const inside = initialsOf(
      raw
        .split(/[\s&/,-]+/)
        .filter((w) => w.length > 0 && INITIALS.test(w[0] ?? "")),
      raw
    );
    if (!inside) return before;
    // The Portal sometimes writes the short form already: "… (CSE)". Repeating
    // the head beside it would print "CSE(CSE)", so the bracket stands alone.
    return inside === raw && inside === before
      ? inside
      : `${before}(${inside})`;
  }
  return initialsOf(
    name
      .split(/[\s&/,-]+/)
      .filter((w) => w.length > 0 && !CONNECTING_WORDS.has(w.toLowerCase()))
      .filter((w) => INITIALS.test(w[0] ?? "")),
    name
  );
}
export type ChosenFact = { label: string; value: string };
export function chosenFacts(
  opts: OptionsReply,
  sel: Sel,
  range?: Range
): ChosenFact[] {
  const facts = LEVELS.flatMap(([key, label]) => {
    const hit = opts[key].find((o) => String(o.value) === String(sel[key]));
    return hit ? [{ label, value: hit.label }] : [];
  });
  // The period is part of naming the register: the card above it and
  // a student's panel state the same facts, so it is written once here.
  if (facts.length && range?.from)
    facts.push({ label: "Period", value: `${range.from} to ${range.to}` });
  return facts;
}
/**
 * A row's background, and nothing else: only a **critical** student is tinted.
 *
 * The irregular band is deliberately not a tint. A class where a third of the
 * roster is irregular is a class where a third of the table is coloured, and the
 * colour stops meaning anything — the eye reads a decorated table rather than a
 * student in trouble. Critical is the band that means act now, so it is the only
 * one worth interrupting a roster for; an irregular student is already badged
 * `low` on their own percentage.
 *
 * The band read is the one the table is showing, which is why `overallMode` is an
 * argument: on the All subjects path there is no subject figure, so reading
 * `s.critical` there would never tint a row and the class-wide report would lose
 * the one thing it was added to expose.
 */
export function tintFor(
  s: RegisterReply["students"][number],
  overallMode = false
): string | undefined {
  const critical = overallMode ? s.overallCritical : s.critical;
  return critical ? "var(--mantine-color-red-light)" : undefined;
}
/**
 * Fixed percentage bars, strictest first. One entry is the bar's key in the
 * filter, its threshold, and its place in the empty-register sentence — the
 * array order decides which ticked bar wins that sentence, so a third bar is
 * one line here rather than branches in three functions.
 */
const FIXED_BARS = [
  { key: "below65", below: 65 },
  { key: "below75", below: 75 },
] as const;
export type FixedBarKey = (typeof FIXED_BARS)[number]["key"];
/**
 * Which worklist filters are ticked. Ticked bars intersect: a row must clear
 * every one, so ticking Below 65% beside Below 75% changes nothing — the
 * stricter bar already implies the other.
 */
export type RowFilter = {
  irregular: boolean;
} & Record<FixedBarKey, boolean>;
export const NO_FILTER: RowFilter = {
  irregular: false,
  below75: false,
  below65: false,
};
/** Whether any bar is ticked: the table is a worklist then, sorted worst-first. */
export function isFiltering(filter: RowFilter): boolean {
  return filter.irregular || filter.below75 || filter.below65;
}
/**
 * The figure a row is judged on, and the one the worklist is ordered by.
 *
 * `overallMode` is the All subjects path, where there is no subject percentage at
 * all. Everywhere else the Subject figure is the one the table leads with — with
 * one exception that is easy to miss: on a Subject register the filter also admits
 * a student for being Irregular *overall*, and such a student may have no subject
 * figure at all. Reading the subject figure alone put the very student the
 * worklist exists to surface at the bottom of it, so the overall figure is used
 * when the subject one is absent. This is the same figure the filter admits a row
 * on, and reading a different one is how the two halves disagree.
 */
function figureFor(
  s: RegisterReply["students"][number],
  overallMode: boolean
): number | null {
  if (overallMode) return s.overallPct;
  return s.pct ?? s.overallPct;
}
/**
 * `Show only irregular` keeps a student who is in trouble in whichever band the
 * table is actually showing. Reading the Subject band on the All subjects path
 * hid the very student the overall column was added to expose: healthy in the
 * one Subject you happened to open, critical across the section.
 *
 * The fixed bars read the same figure the worklist is ordered by. A missing
 * figure is an absence, not a low one, so it clears no fixed bar.
 */
export function visibleStudents(
  students: readonly RegisterReply["students"][number][],
  filter: RowFilter,
  overallMode: boolean
): RegisterReply["students"][number][] {
  if (!isFiltering(filter)) return [...students];
  return students.filter((s) => {
    if (
      filter.irregular &&
      !(overallMode ? s.overallIrregular : s.overallIrregular || s.irregular)
    )
      return false;
    const figure = figureFor(s, overallMode);
    for (const { key, below } of FIXED_BARS) {
      if (filter[key] && !(figure != null && figure < below)) return false;
    }
    return true;
  });
}
/**
 * The rows as the table shows them, and the order it shows them in.
 *
 * **Unfiltered, the Portal's own roster order — no sort.** The register used to be
 * ordered lowest attendance first, which turned a roster into a ranking: the
 * numbers stopped reading as facts about named students and started reading as a
 * league table, and the `Sl.No` column — the one thing tying a row to the Portal —
 * stopped running down the page. Over a whole class the sort answers a question
 * nobody asked.
 *
 * **Filtered, worst first — and that is the point of the ticked filters.** The filtered
 * table is a worklist, not a roster: it exists to be worked through, so the
 * student who most needs a check-in is the first one reached. Sorting only here is
 * what lets both be true at once, where sorting everywhere could only be one or
 * the other.
 *
 * A missing figure sorts last rather than first. `null` means the Portal gave no
 * figure at all, which is not good attendance, and putting such a student at the
 * top of a triage list would send someone to check on them for the wrong reason.
 *
 * The order is decided here rather than in `App.tsx` so it can be pinned by a test
 * that needs no Portal: this function was the sort's only home, and a rule in a
 * component is a rule that survives the change that makes it wrong.
 */
export function registerRows(
  students: readonly RegisterReply["students"][number][],
  filter: RowFilter,
  overallMode: boolean
): RegisterReply["students"][number][] {
  const shown = visibleStudents(students, filter, overallMode);
  if (!isFiltering(filter)) return shown;
  return shown.toSorted((a, b) => {
    const left = figureFor(a, overallMode);
    const right = figureFor(b, overallMode);
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return left - right;
  });
}
/**
 * What an empty register says: the bar the reader set, so an empty worklist
 * reads as "nobody is under the bar" rather than "the register failed". The
 * strictest fixed bar wins the sentence; the irregular one keeps its own,
 * which points at the Portal's threshold instead of a number.
 */
export function emptyRegisterText(
  filter: RowFilter,
  irregularBelow: number
): string {
  const bar = FIXED_BARS.find(({ key }) => filter[key]);
  if (bar) return `No students below ${bar.below}%.`;
  if (filter.irregular)
    return `No irregular students. Everyone is at or above ${irregularBelow}%.`;
  return "No students in this register.";
}
