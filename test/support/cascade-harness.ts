import type {
  Option,
  OptionsReply,
  Student,
  TodayClass,
} from "../../shared/api";
import { chosenFacts } from "../../web/register/cascade";
import type { ChosenFact, Level, Sel } from "../../web/register/cascade";
import { NO_FILTER } from "../../web/register/worklist";
import type { RowFilter } from "../../web/register/worklist";

/** One grid row: hours stated, or none at all once ECAP clears the day. */
export const slot = (period: string, time: string): TodayClass => ({
  period,
  time,
  subject: time ? "AI" : "",
  section: time ? "3 IT-C" : "",
  room: "",
});
export const opt = (
  value: string,
  label = `L${value}`,
  title = ""
): Option => ({
  value,
  label,
  title,
});
/** A RowFilter with one subject-column threshold ticked. */
export const bar = (code: string, below: 75 | 65): RowFilter => ({
  ...NO_FILTER,
  subjectBars: [{ code, below }],
});
export const reply = (perLevel: Record<Level, string[]>): OptionsReply => ({
  course: perLevel.course.map((v) => opt(v)),
  semester: perLevel.semester.map((v) => opt(v)),
  branch: perLevel.branch.map((v) => opt(v)),
  section: perLevel.section.map((v) => opt(v)),
  subject: perLevel.subject.map((v) => opt(v)),
  emptyLevels: [],
});
export const sel = (partial: Partial<Sel> = {}): Sel => ({
  course: "",
  semester: "",
  branch: "",
  section: "",
  subject: "",
  ...partial,
});
export const nothing = reply({
  course: [],
  semester: [],
  branch: [],
  section: [],
  subject: [],
});
/** The old single-checkbox filter, spelled in the new shape. */
export const irregularOnly: RowFilter = { ...NO_FILTER, irregular: true };
/** The Date Range tail for a fixed selection and range, varying only the
 *  register's own class-day count: the range fact, then classes held — or
 *  the bare range where the Portal stated no count. */
export const dateRangeTail = (classesHeld?: number | null): ChosenFact[] => {
  const facts = chosenFacts(
    reply({
      course: ["1"],
      semester: ["3"],
      branch: ["4"],
      section: ["5"],
      subject: ["6"],
    }),
    sel({
      course: "1",
      semester: "3",
      branch: "4",
      section: "5",
      subject: "6",
    }),
    { range: { from: "01/10/2026", to: "16/10/2026" }, classesHeld }
  );
  return facts.slice(
    facts.findIndex((fact) => fact.label.startsWith("Date Range"))
  );
};
/** The same tail, with the register stating where its own data begins: the
 *  fact then names that day, and the frame counts from it. The Sem Start Date
 *  row takes the earliest day known, which can predate this window. */
export const statedTail = (
  statedFrom: string,
  semStart?: string
): ChosenFact[] => {
  const facts = chosenFacts(
    reply({
      course: ["1"],
      semester: ["3"],
      branch: ["4"],
      section: ["5"],
      subject: ["6"],
    }),
    sel({
      course: "1",
      semester: "3",
      branch: "4",
      section: "5",
      subject: "6",
    }),
    {
      range: { from: "01/07/2026", to: "16/10/2026" },
      classesHeld: 6,
      statedFrom,
      semStart,
    }
  );
  return facts.slice(
    facts.findIndex((fact) => fact.label.startsWith("Date Range"))
  );
};
/** The reply for a run whose first pass settles the course and nothing else:
 *  every later pass fails, so the run must carry this on its error. */
export const courseOnlyReply = (): OptionsReply =>
  reply({
    course: ["1"],
    semester: [],
    branch: [],
    section: [],
    subject: [],
  });
/** The reply for a selection the Portal agrees with: every level offered. */
export const fullReply = (): OptionsReply =>
  reply({
    course: ["1"],
    semester: ["3"],
    branch: ["4"],
    section: ["5"],
    subject: ["6"],
  });
export const student = (pct: number | null): Student => ({
  sl: "1",
  roll: "21CS001",
  name: "A Student",
  attendedOfHeld: "38/45",
  pct,
  irregular: pct != null && pct < 75,
  critical: pct != null && pct < 60,
  overallPct: 79.21,
  overallAttendedOfHeld: "381\\481",
  overallIrregular: false,
  overallCritical: false,
  subjects: [],
  absent: [],
});

/** Node has no localStorage, and the range helpers are written to survive its
 *  absence, so without this the remembered-start tests pass for the wrong
 *  reason: every write throws, every read falls back. */
export const saved = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => saved.set(k, v),
  removeItem: (k: string) => saved.delete(k),
  clear: () => saved.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

export const CLASS_A: Sel = {
  course: "1",
  semester: "3",
  branch: "5",
  section: "A",
  subject: "101",
};
