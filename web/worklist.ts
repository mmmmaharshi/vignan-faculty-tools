import type { RegisterReply } from "../shared/api";

/** Which figure a percentage is: the subject's own, or the section-wide overall.
 *  The two differ in emphasis — the subject figure reads heavier, and its low
 *  badge is yellow where the overall's is orange — so that pairing lives here,
 *  in one map, instead of as literals at every call site. */
export type FigureKind = "subject" | "overall";
export const FIGURE_STYLE = {
  subject: { weight: 700, low: "yellow" },
  overall: { weight: 600, low: "orange" },
} as const;
/** The overall badge is orange where the subject one is yellow, so a row
 *  badged on one and not the other is readable at a glance. Exported because a
 *  student's own panel badges the same two figures and must say the same words. */
export const badgeFor = (
  critical: boolean,
  irregular: boolean,
  kind: FigureKind
): { badge: string; color: string } => {
  if (critical) return { badge: "critical", color: "red" };
  if (irregular) return { badge: "low", color: FIGURE_STYLE[kind].low };
  return { badge: "", color: "red" };
};
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
  /** Free text matched against name and roll number. Blank means no search. */
  search: string;
} & Record<FixedBarKey, boolean>;
export const NO_FILTER: RowFilter = {
  irregular: false,
  below75: false,
  below65: false,
  search: "",
};
/** Whether any bar is ticked or any search is typed: the table is a worklist
 *  then, sorted worst-first. */
export function isFiltering(filter: RowFilter): boolean {
  return (
    filter.irregular ||
    filter.below75 ||
    filter.below65 ||
    filter.search.trim() !== ""
  );
}
/**
 * The figure a row is judged on, and the one the worklist is ordered by: the one
 * the table is actually showing. `overallMode` is the All subjects path, which
 * shows the overall percentage and no subject percentage at all; everywhere else
 * the table shows the Subject figure alone. The overall figure is deliberately
 * not read as a fallback here — on a Subject register it is not on screen, so a
 * row admitted or ordered by it would be a row with nothing to explain it.
 */
function figureFor(
  s: RegisterReply["students"][number],
  overallMode: boolean
): number | null {
  return overallMode ? s.overallPct : s.pct;
}
/**
 * `All irregular students` keeps a student who is in trouble in whichever band
 * the table is actually showing — the Subject band on a subject register, the
 * overall band on All subjects. Reading the Subject band on the All subjects path
 * hid the very student the overall column was added to expose: healthy in the one
 * Subject you happened to open, critical across the section. Reading the overall
 * band on the subject path fails the other way round: it keeps a row for a band
 * that path does not show, so nothing on screen explains why the row is there.
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
  // Rolls are typed as remembered and names show upper-cased, so both halves
  // of the match read lower-cased: the match cannot care about case.
  const needle = filter.search.trim().toLowerCase();
  return students.filter((s) => {
    if (
      needle !== "" &&
      !s.name.toLowerCase().includes(needle) &&
      !s.roll.toLowerCase().includes(needle)
    )
      return false;
    if (filter.irregular && !(overallMode ? s.overallIrregular : s.irregular))
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
  // The search names what is on screen — the box the user is looking at — so
  // its sentence wins over whichever bars are also ticked.
  const needle = filter.search.trim();
  if (needle !== "") return `No students match "${needle}".`;
  const bar = FIXED_BARS.find(({ key }) => filter[key]);
  if (bar) return `No students below ${bar.below}%.`;
  if (filter.irregular)
    return `No irregular students. Everyone is at or above ${irregularBelow}%.`;
  return "No students in this register.";
}
