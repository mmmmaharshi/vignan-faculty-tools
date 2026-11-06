import type { RegisterReply } from "../../shared/api";
import { CRITICAL_BELOW, IRREGULAR_BELOW } from "../../shared/api";

/** One student row out of a register reply, subject figures and overall ones. */
export type StudentRow = RegisterReply["students"][number];

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
 * A student's name the way a reader writes it. ECAP states names in all
 * caps, and CSS capitalise leaves all-caps input untouched — so the casing
 * is done here, once, where every name on screen passes through.
 */
export const displayName = (name: string): string =>
  name.toLowerCase().replaceAll(/(?:^|\s)\S/g, (c) => c.toUpperCase());
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
  s: StudentRow,
  overallMode = false
): string | undefined {
  const critical = overallMode ? s.overallCritical : s.critical;
  return critical ? "var(--mantine-color-red-light)" : undefined;
}
/**
 * The two section-wide bars, in the order the checkboxes read them. One entry is
 * the bar's key in the filter, and the threshold it admits — read from the same
 * two constants the server bands every figure with, so a checkbox can never say
 * 75 while the summary counts 70. A third bar is one line here plus the table's
 * own map over it, rather than branches in three functions.
 */
export const BARS = [
  { key: "below75", below: IRREGULAR_BELOW },
  { key: "below65", below: CRITICAL_BELOW },
] as const;
export type FixedBarKey = (typeof BARS)[number]["key"];
export type BarBelow = (typeof BARS)[number]["below"];
/** One threshold on one subject column, named by the column's own code:
 *  the bar admits the rows under it in that subject. Absent codes are inert
 *  rather than errors — the filter travels between classes, and a bar for a
 *  column this table does not show must do nothing here rather than fail. */
export type SubjectBar = { code: string; below: BarBelow };
/**
 * One subject column's threshold, cycled in place by its header: unset, then a
 * step down the `BARS` list, then unset again. One control per column, so the
 * header is the whole of the UI for it — no second place can disagree on what
 * a click does. Absent where the row has no such column is handled by the
 * caller dropping unknown codes, not here.
 */
export function cycleSubjectBar(
  bars: readonly SubjectBar[],
  code: string
): SubjectBar[] {
  const rest = bars.filter((b) => b.code !== code);
  const current = bars.findIndex((b) => b.code === code);
  if (current === -1 || bars[current] === undefined) {
    return [...rest, { code, below: BARS[0].below }];
  }
  const at = BARS.findIndex((b) => b.below === bars[current]?.below);
  const next = BARS[at + 1];
  return next ? [...rest, { code, below: next.below }] : rest;
} /**
 * Keeps only the bars naming a subject the newly settled class offers. A bar
 * for a column this class does not show must not travel with the selection:
 * it would narrow a roster with nothing on screen saying so, and the way
 * back — the column header — is not on screen either.
 */
export function pruneSubjectBars(
  bars: readonly SubjectBar[],
  offered: readonly string[]
): SubjectBar[] {
  return bars.filter((b) => offered.includes(b.code));
}
/**
 * Which worklist filters are ticked. Ticked bars intersect: a row must clear
 * every one, so ticking Below 65% beside Below 75% changes nothing — the
 * stricter bar already implies the other. Subject bars join that intersection:
 * a row must clear every ticked column threshold too, and a dash clears none.
 */
export type RowFilter = {
  irregular: boolean;
  /** Free text matched against name and roll number. Blank means no search. */
  search: string;
  /** Per-subject thresholds, in the order they were ticked. */
  subjectBars: SubjectBar[];
} & Record<FixedBarKey, boolean>;
export const NO_FILTER: RowFilter = {
  irregular: false,
  below75: false,
  below65: false,
  search: "",
  subjectBars: [],
};
/** Whether any bar is ticked or any search is typed: the table is a worklist
 *  then, sorted worst-first. */
export function isFiltering(filter: RowFilter): boolean {
  return (
    filter.irregular ||
    filter.below75 ||
    filter.below65 ||
    filter.subjectBars.length > 0 ||
    filter.search.trim() !== ""
  );
}
/**
 * Whether a row carries an overall figure to show: a percentage, or an
 * attended-of-held count where the percentage itself never arrived. The one
 * place the two fields' joint meaning lives, so the table column and the
 * panel row cannot drift apart on what "has an overall" means.
 */
export function carriesOverall(s: StudentRow): boolean {
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
function figureFor(s: StudentRow, overallMode: boolean): number | null {
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
  students: readonly StudentRow[],
  filter: RowFilter,
  overallMode: boolean,
  subjectColumns: readonly string[] = []
): StudentRow[] {
  // Rolls are typed as remembered and names show upper-cased, so both halves
  // of the match read lower-cased: the match cannot care about case. A blank
  // needle matches every row, so a bare roster needs no early return here.
  const needle = filter.search.trim().toLowerCase();
  // Subject bars name columns by code; one the table does not show is inert.
  const bars = filter.subjectBars.flatMap(({ code, below }) => {
    const at = subjectColumns.indexOf(code);
    return at === -1 ? [] : [{ at, below }];
  });
  return students.filter((s) => {
    if (
      !s.name.toLowerCase().includes(needle) &&
      !s.roll.toLowerCase().includes(needle)
    )
      return false;
    if (filter.irregular && !(overallMode ? s.overallIrregular : s.irregular))
      return false;
    const figure = figureFor(s, overallMode);
    for (const { key, below } of BARS) {
      if (filter[key] && !(figure != null && figure < below)) return false;
    }
    for (const { at, below } of bars) {
      const value = s.subjects[at];
      if (!(value != null && value < below)) return false;
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
  students: readonly StudentRow[],
  filter: RowFilter,
  overallMode: boolean,
  subjectColumns: readonly string[] = []
): StudentRow[] {
  const shown = visibleStudents(students, filter, overallMode, subjectColumns);
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
 * strictest ticked bar wins the sentence — picked by its number, not by its
 * place in `BARS`, which reads in checkbox order; the irregular one keeps its
 * own, which points at the Portal's threshold instead of a number.
 */
export function emptyRegisterText(
  filter: RowFilter,
  irregularBelow: number
): string {
  const needle = filter.search.trim();
  const [bar] = BARS.filter(({ key }) => filter[key]).toSorted(
    (a, b) => a.below - b.below
  );
  // The search and the bars are one question between them, so a row that clears
  // neither is explained by both: naming only the search would leave a ticked bar
  // looking as if it had done nothing.
  const matching = needle === "" ? "" : ` matching "${needle}"`;
  if (bar) return `No students${matching} below ${bar.below}%.`;
  const [subject] = filter.subjectBars;
  if (subject)
    return `No students${matching} below ${subject.below}% in ${subject.code}.`;
  if (filter.irregular)
    return needle === ""
      ? `No irregular students. Everyone is at or above ${irregularBelow}%.`
      : `No irregular students${matching}.`;
  if (needle !== "") return `No students match "${needle}".`;
  return "No students in this register.";
}
/**
 * How many rows each ticked bar alone would keep, under the current search
 * but ignoring the other ticked bars: ticking one box never moves another
 * box's count, so the numbers stay put while the table narrows. Subject-bar
 * filters are deliberately not part of the bargain: the boxes name the
 * section-wide bars, and a column threshold narrows beneath them.
 */
export type BarCounts = { irregular: number; below75: number; below65: number };
export function barCounts(
  students: readonly StudentRow[],
  search: string,
  overallMode: boolean
): BarCounts {
  const base: RowFilter = {
    irregular: false,
    below75: false,
    below65: false,
    search,
    subjectBars: [],
  };
  const count = (patch: Partial<RowFilter>): number =>
    visibleStudents(students, { ...base, ...patch }, overallMode, []).length;
  return {
    irregular: count({ irregular: true }),
    below75: count({ below75: true }),
    below65: count({ below65: true }),
  };
}
