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
 * Whether a row carries an overall figure to show: a percentage, or an
 * attended-of-held count where the percentage itself never arrived. The one
 * place the two fields' joint meaning lives, so the table column and the
 * panel row cannot drift apart on what "has an overall" means.
 */
export function carriesOverall(s: RegisterReply["students"][number]): boolean {
  return s.overallPct != null || s.overallAttendedOfHeld !== "";
}
/**
 * The figure a row is judged on, and the one the worklist is ordered by: the
 * subject figure, everywhere but the All subjects path. `overallMode` is the
 * All subjects path, which shows the overall percentage and no subject
 * percentage at all. Both figures are on screen on a subject register, but
 * the worklist still judges one: the overall is a second fact on the row,
 * never the bar that admits it or the order it sorts by.
 */
function figureFor(
  s: RegisterReply["students"][number],
  overallMode: boolean
): number | null {
  return overallMode ? s.overallPct : s.pct;
}
/**
 * `All irregular students` keeps a student who is in trouble in whichever band
 * the path judges by — the Subject band on a subject register, the overall
 * band on All subjects. Reading the Subject band on the All subjects path
 * hid the very student the overall column was added to expose: healthy in the one
 * Subject you happened to open, critical across the section. Reading the overall
 * band on the subject path fails the other way round: the worklist would keep
 * rows for a band it does not judge by, so nothing on screen explains the cut.
 *
 * The fixed bars read the same figure the worklist is ordered by. A missing
 * figure is an absence, not a low one, so it clears no fixed bar.
 */
export function visibleStudents(
  students: readonly RegisterReply["students"][number][],
  filter: RowFilter,
  overallMode: boolean
): RegisterReply["students"][number][] {
  // Rolls are typed as remembered and names show upper-cased, so both halves
  // of the match read lower-cased: the match cannot care about case. A blank
  // needle matches every row, so a bare roster needs no early return here.
  const needle = filter.search.trim().toLowerCase();
  return students.filter((s) => {
    if (
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
  const needle = filter.search.trim();
  const bar = FIXED_BARS.find(({ key }) => filter[key]);
  // The search and the bars are one question between them, so a row that clears
  // neither is explained by both: naming only the search would leave a ticked bar
  // looking as if it had done nothing.
  const matching = needle === "" ? "" : ` matching "${needle}"`;
  if (bar) return `No students${matching} below ${bar.below}%.`;
  if (filter.irregular)
    return needle === ""
      ? `No irregular students. Everyone is at or above ${irregularBelow}%.`
      : `No irregular students${matching}.`;
  if (needle !== "") return `No students match "${needle}".`;
  return "No students in this register.";
}
