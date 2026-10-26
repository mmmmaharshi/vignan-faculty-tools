import { ALL_SUBJECTS, isAllSubjects, todayIST } from "../shared/api.js";
import type {
  CascadeLevel,
  FacultyProfile,
  FindReply,
  FindRequest,
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  SemAbsencesReply,
  SemAbsencesRequest,
  SemStartReply,
  SemStartRequest,
  StudentProfile,
  StudentRequest,
  TodayClassesReply,
  UnpostedReply,
} from "../shared/api.js";
import type { OverallLookup } from "./attendance-bands.js";
import { statedStartDate, summarise } from "./attendance-bands.js";
import type { DayWorkRequest } from "./portal-conventions.js";
import { courseVerdict } from "./portal-liveness.js";
import {
  HttpError,
  level,
  matchOption,
  parseClassAttendance,
  parseRegister,
  parseStudentAbsences,
  parseStudentClass,
  parseStudentProfile,
  parseTodayClasses,
  parseDayClassWork,
  realOptions,
  registerDates,
  studentWiseDates,
} from "./portal-replies.js";
import type { OverallRow, StatedClass } from "./portal-replies.js";

type Level = CascadeLevel;
export type PortalReader = {
  courses: () => Promise<Option[]>;
  branchesAndSemesters: (courseId: string) => Promise<[Option[], Option[]]>;
  sections: (
    courseId: string,
    branchId: string,
    semester: string,
    semesterTitle?: string
  ) => Promise<Option[]>;
  subjects: (
    courseId: string,
    branchId: string,
    semesterId: string
  ) => Promise<Option[]>;
  register: (
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
  classAttendance: (
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
  /** The StudentProfile page's markup for one roll number. */
  studentProfile: (roll: string) => Promise<string>;
  facultyProfile: () => Promise<FacultyProfile>;
  /** The Student Wise report: one student's grid, every subject, one column per
   *  day the section met. */
  studentWise: (
    roll: string,
    name: string,
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
  /** The faculty dashboard's schedule fragment for today. */
  todayClasses: () => Promise<string>;
  /** The day-class-work report's fragment for the asked branches and date. */
  dayClassWork: (p: DayWorkRequest) => Promise<string>;
};
export async function handleOptions(
  portal: PortalReader,
  b: OptionsRequest
): Promise<OptionsReply> {
  const emptyLevels: Level[] = [];
  const out: OptionsReply = {
    course: [],
    semester: [],
    branch: [],
    section: [],
    subject: [],
    emptyLevels,
  };
  const take = (key: Level, list: Option[]): void => {
    const { choices, empty } = level(realOptions(list));
    out[key] = choices;
    if (empty) emptyLevels.push(key);
  };
  const { verdict, courses: courseOptions } = await courseVerdict(portal);
  if (verdict === "dead") {
    throw new HttpError(
      401,
      "Your ECAP session expired. Please sign in again."
    );
  }
  if (verdict === "unknown") {
    throw new HttpError(502, "ECAP did not answer the course list. Try again.");
  }
  take("course", courseOptions);
  if (b.course) {
    const [branches, semesters] = await portal.branchesAndSemesters(b.course);
    take("branch", branches);
    take("semester", semesters);
  }
  if (b.course && b.branch && b.semester) {
    take(
      "section",
      await portal.sections(b.course, b.branch, b.semester, b.semesterTitle)
    );
  }
  if (b.course && b.branch && b.semester && b.section) {
    take("subject", await portal.subjects(b.course, b.branch, b.semester));
    // First, so the whole section is one click away, and upper-cased so it reads
    // as a mode rather than as one of the portal's short codes. An empty level
    // must stay empty, or the cascade would think it had nothing left to fetch.
    if (out.subject.length) out.subject = [ALL_SUBJECTS, ...out.subject];
  }
  return out;
}
function chosenLevel(b: Partial<RegisterRequest>, key: Level): Option {
  const o = b[key];
  if (!o?.value || !o?.label) throw new HttpError(400, `Choose a ${key}.`);
  return o;
}
export function requireLevels(
  b: Partial<RegisterRequest>
): Record<Level, Option> {
  return {
    course: chosenLevel(b, "course"),
    semester: chosenLevel(b, "semester"),
    branch: chosenLevel(b, "branch"),
    section: chosenLevel(b, "section"),
    subject: chosenLevel(b, "subject"),
  };
}
/**
 * The class-wide report is a second Portal screen. If it fails, or its layout
 * has moved, the register that already worked must still render, so nothing here
 * is allowed to throw on the subject path. See
 * .scratch/overall-attendance/issues/01.
 */
async function readOverall(
  portal: PortalReader,
  p: Record<Level, Option> & { from: string; to: string }
): Promise<{ rows: OverallRow[]; byRoll: OverallLookup }> {
  try {
    const rows = parseClassAttendance(await portal.classAttendance(p));
    return {
      rows,
      byRoll: new Map(
        rows.map((row) => [
          row.roll,
          { attendedOfHeld: row.attendedOfHeld, pct: row.pct },
        ])
      ),
    };
  } catch (error) {
    // A dead session must stay a 401 or the client will not sign anyone out;
    // everything else is a report this screen can do without.
    if (error instanceof HttpError && error.status === 401) throw error;
    return { rows: [], byRoll: new Map() };
  }
}
export async function handleRegister(
  portal: PortalReader,
  b: Partial<RegisterRequest>
): Promise<RegisterReply> {
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");
  const p = requireLevels(b);
  const { from, to } = b;
  const range = { from, to };
  if (isAllSubjects(p.subject)) {
    // No subject was chosen, so the class report is the whole register and its
    // emptiness is a real failure rather than a report to render without.
    const { rows, byRoll } = await readOverall(portal, { ...p, from, to });
    if (!rows.length) {
      throw new HttpError(
        502,
        "The class attendance report came back empty. Either the section has no classes in that date range, or ECAP's page layout has changed."
      );
    }
    return summarise(
      rows.map((row) => ({
        sl: row.sl,
        roll: row.roll,
        name: row.name,
        attendedOfHeld: "",
        pct: null,
        absent: [],
      })),
      range,
      byRoll
    );
  }
  const reply = await portal.register({ ...p, from, to });
  const rows = parseRegister(reply);
  if (!rows.length) {
    throw new HttpError(
      502,
      "The register came back empty. Either the subject has no classes in that date range, or ECAP's page layout has changed."
    );
  }
  const { byRoll } = await readOverall(portal, { ...p, from, to });
  // The grid's own date columns are the working-days count: a grid that
  // states none leaves the summary bare rather than printing a zero. The
  // first one is where the figures begin, so the input can snap to it.
  const dates = registerDates(reply);
  return summarise(
    rows,
    range,
    byRoll,
    dates.length || null,
    statedStartDate(dates, range),
    dates
  );
}
/**
 * The dates this student missed, across every subject, but only when the register
 * on screen is the **All subjects** view: its report aggregates by subject and
 * states no dates, so this student's own grid is the only place they exist. A
 * subject register already states them, and one Portal call per panel open is the
 * budget (ADR 0018), so nothing is asked for on that path.
 *
 * A report ECAP will not give changes nothing else: the panel's GPA and numbers
 * are the main read, and a 401 still ends the session.
 */
/** A dead ECAP session must stay a 401 so the client signs out; every other
 *  portal failure is the caller's to interpret. The one place that rule lives,
 *  so the three readers below cannot drift apart on it. */
function rethrowExpired(error: unknown): void {
  if (error instanceof HttpError && error.status === 401) throw error;
}
/** One student's absent days from their own day-wise grid, over the window
 *  given. Absent where the grid states none — which is not a clean sheet. A
 *  failure throws; the callers decide what a failure means for them. */
async function studentWiseAbsent(
  portal: PortalReader,
  roll: string,
  name: string,
  p: Record<Level, Option> & { from: string; to: string }
): Promise<{ absent?: string[] }> {
  const absent = parseStudentAbsences(await portal.studentWise(roll, name, p));
  return absent ? { absent } : {};
}
async function readAbsences(
  portal: PortalReader,
  roll: string,
  b: Partial<StudentRequest>
): Promise<{ absent?: string[] }> {
  const { register } = b;
  if (!register || !isAllSubjects(register.subject)) return {};
  try {
    return await studentWiseAbsent(portal, roll, b.name ?? "", {
      ...requireLevels(register),
      from: register.from,
      to: register.to,
    });
  } catch (error) {
    rethrowExpired(error);
    return {};
  }
}
/** One calendar month as a portal window, dd/mm/yyyy both ends. Month shapes
 *  are the only range ECAP reliably answers — live runs show wide registers
 *  come back empty — so both walks below read month by month. */
function monthWindow(
  year: number,
  month: number
): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  return {
    from: `01/${mm}/${year}`,
    to: `${new Date(year, month, 0).getDate()}/${mm}/${year}`,
  };
}
/** The month before, across a year boundary. */
function previousMonth(
  year: number,
  month: number
): { year: number; month: number } {
  return month > 1 ? { year, month: month - 1 } : { year: year - 1, month: 12 };
}
/**
 * A grid's date columns belonging to one month, in the grid's own order. Only
 * this month's own columns may name anything below: the year attached there
 * is the step's own. The comparison is numeric because the Portal is not
 * trusted to zero-pad.
 */
function datesInMonth(dates: readonly string[], month: number): string[] {
  return dates.filter((c) => Number(c.split("/")[1]) === month);
}
/** The month's own first held day as dd/mm/yyyy, or null where the grid
 *  states none of it. */
function monthStart(
  dates: readonly string[],
  year: number,
  month: number
): string | null {
  const [day] = (datesInMonth(dates, month)[0] ?? "").split("/");
  if (!day) return null;
  const mm = String(month).padStart(2, "0");
  return `${day.padStart(2, "0")}/${mm}/${year}`;
}
/**
 * One student's absent days over the whole semester: the section's Student
 * Wise grid walked back one month at a time from the asked window, unioned
 * oldest-first. Single-month windows are the only shape used — live runs show
 * wide subject registers come back empty while month shapes answer, so no
 * range wider than a month is ever asked — and the walk stops at the first
 * month whose grid states no meeting days (cap twelve). A month the Portal
 * will not give, or a walk that never finds a dateless month, ends with a
 * warning rather than a silent partial list; a 401 still ends the session.
 * (A whole break month with no meetings would stop the walk early; accepted
 * because a section meets continuously.)
 */
async function readFullSemesterAbsences(
  portal: PortalReader,
  roll: string,
  name: string,
  p: Record<Level, Option> & { from: string; to: string }
): Promise<{
  absent: string[] | null;
  range: { from: string; to: string } | null;
  note: string;
}> {
  const [fd, fm, fy] = p.from.split("/").map(Number);
  const [td, tm, ty] = p.to.split("/").map(Number);
  if (!fd || !fm || !fy || !td || !tm || !ty) {
    return { absent: null, range: null, note: "" };
  }
  const perMonth: string[][] = [];
  let start: string | null = null;
  let stoppedEarly = false;
  let year = ty;
  let month = tm;
  for (let step = 0; step < 12; step++) {
    const window = monthWindow(year, month);
    let grid: string;
    try {
      grid = await portal.studentWise(roll, name, { ...p, ...window });
    } catch (error) {
      rethrowExpired(error);
      return {
        absent: perMonth.length ? perMonth.flat() : null,
        range: start ? { from: start, to: p.to } : null,
        note: "ECAP would not give every month's absent days, so the full-semester list below may be incomplete.",
      };
    }
    const startOfMonth = monthStart(studentWiseDates(grid), year, month);
    if (!startOfMonth) {
      stoppedEarly = true;
      break;
    }
    start = startOfMonth;
    perMonth.unshift(parseStudentAbsences(grid) ?? []);
    ({ year, month } = previousMonth(year, month));
  }
  if (!start) return { absent: null, range: null, note: "" };
  return {
    absent: perMonth.flat(),
    range: { from: start, to: p.to },
    note: stoppedEarly
      ? ""
      : "ECAP kept stating meeting days twelve months back, so the semester may have started earlier than shown.",
  };
}
/**
 * One student's GPA and phone numbers, read on demand when their row is opened.
 * The register states neither, so the Portal is asked about a single student here
 * and nowhere else — except on the All subjects path, where `readAbsences` asks
 * for one more thing, that student's own grid, because the report on screen states
 * no dates at all.
 */
export async function handleStudentProfile(
  portal: PortalReader,
  b: Partial<StudentRequest>
): Promise<StudentProfile> {
  const roll = b.roll?.trim();
  if (!roll) throw new HttpError(400, "Choose a student.");
  const profile = parseStudentProfile(await portal.studentProfile(roll));
  if (!profile) {
    throw new HttpError(
      502,
      "ECAP's student profile page came back in an unexpected shape, so its GPA and phone numbers could not be read."
    );
  }
  return { ...profile, ...(await readAbsences(portal, roll, b)) };
}
/** Roman/Arabic numeral for a semester label: "III Semester" -> 3. */
const ROMAN: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
};
function semesterNumber(text: string): number | null {
  const t = text.trim().toUpperCase();
  const roman = t.match(/^(?<r>[IVX]+)\b/);
  if (roman?.groups?.r) {
    const { r } = roman.groups;
    if (ROMAN[r] !== undefined) return ROMAN[r];
  }
  const arabic = t.match(/(?<n>\d+)/);
  if (arabic?.groups?.n) return Number(arabic.groups.n);
  return null;
}
/** The semester the student is in now, guessed from the SGPAs the page
 *  states: the highest completed, plus one. Null when the page states no
 *  usable SGPA list — with nothing completed to count from, even the first
 *  semester would be a guess, so the caller refuses instead. A guess, and it
 *  can be wrong for a repeater — see ADR 0025. */
function inferSemester(profile: StudentProfile): number | null {
  const done = profile.sgpa
    .map((s) => semesterNumber(s.semester))
    .filter((n): n is number => n !== null);
  if (!done.length) return null;
  return Math.max(...done) + 1;
}
/** The class a student's own page puts them in, matched to the Portal's own
 *  option values, and the sections that class offers. A page that states a
 *  section names one section; one that states none names all of them, and the
 *  search reads each until the roll turns up. */
type StudentClass = {
  levels: Record<"course" | "semester" | "branch", Option>;
  sections: Option[];
  label: string;
  /** True when the semester came from the SGPA guess rather than the page. */
  semesterInferred: boolean;
};
const unstated = (what: string, stated: string): string =>
  stated
    ? `ECAP's profile page states the ${what} "${stated}", which the Portal's own list does not offer.`
    : `ECAP's profile page does not state a ${what}, so no class register can be read for this student.`;
async function resolveClass(
  portal: PortalReader,
  stated: StatedClass,
  profile: StudentProfile
): Promise<StudentClass | string> {
  const course = matchOption(stated.course, await portal.courses());
  if (!course) return unstated("course", stated.course);
  const [branches, semesters] = await portal.branchesAndSemesters(course.value);
  const branch = matchOption(stated.branch, branches);
  if (!branch) return unstated("branch", stated.branch);
  let semester: Option | null;
  let semesterInferred = false;
  if (stated.semester) {
    semester = matchOption(stated.semester, semesters);
    if (!semester) return unstated("semester", stated.semester);
  } else {
    // The page states no semester; infer the current one from the SGPAs it
    // does state — the highest completed, plus one. A guess, and it can be
    // wrong for a repeater; the only way to be sure is to ask (option 3).
    const inferred = inferSemester(profile);
    if (inferred === null) {
      return "ECAP's profile page does not state a semester, and its SGPA list states no completed semester to infer one from.";
    }
    semester =
      semesters.find((o) => semesterNumber(o.label) === inferred) ?? null;
    if (!semester) {
      return `ECAP's profile page does not state a semester, and the one inferred from its SGPA list (${inferred}) is not one the Portal offers.`;
    }
    semesterInferred = true;
  }
  const listed = await portal.sections(
    course.value,
    branch.value,
    semester.value,
    semester.title
  );
  const section = matchOption(stated.section, listed);
  const sections = section ? [section] : listed;
  if (!sections.length) {
    return `ECAP lists no sections for ${branch.label}, ${semester.label}, so there is no register to read.`;
  }
  return {
    levels: { course, semester, branch },
    sections,
    label: `${course.label} · ${semester.label} · ${branch.label}`,
    semesterInferred,
  };
}
/**
 * One roll number in, the student's class and attendance figure out.
 *
 * The class comes from the student's own profile page — the one ECAP answer a
 * roll number is enough for — and the figure from the class attendance report
 * that page's class is read over. No picker, so a class the page states and the
 * Portal's lists do not agree on is a named answer rather than a guess.
 *
 * This is a deliberate ask from the Student Search tab, which is why it reads a
 * register at all; the refresh loop still never fetches one.
 */
export async function handleFind(
  portal: PortalReader,
  b: Partial<FindRequest>
): Promise<FindReply> {
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");
  const roll = b.roll?.trim();
  if (!roll) throw new HttpError(400, "Enter a roll number.");
  const html = await portal.studentProfile(roll);
  const profile = parseStudentProfile(html);
  if (!profile) {
    throw new HttpError(
      502,
      "ECAP's student profile page came back in an unexpected shape, so its GPA and phone numbers could not be read."
    );
  }
  const found = await resolveClass(portal, parseStudentClass(html), profile);
  if (typeof found === "string") {
    return {
      profile,
      class: null,
      window: { from: b.from, to: b.to },
      student: null,
      fullAbsent: null,
      fullRange: null,
      note: found,
    };
  }
  // The class report states no dates, so its window is whatever we ask for.
  const window = { from: b.from, to: b.to };
  // A report no section could give is a portal failure, not an absent student:
  // only a report that answered without the roll earns the "No row" note.
  let reportFailed: unknown = null;
  let reportAnswered = false;
  for (const section of found.sections) {
    const gridRequest = {
      ...found.levels,
      section,
      subject: ALL_SUBJECTS,
      from: window.from,
      to: window.to,
    };
    const reply = await handleRegister(portal, gridRequest).catch(
      (error: unknown) => {
        // A dead session must still sign out. Anything else is one section this
        // search can do without: the next one may hold the roll.
        rethrowExpired(error);
        reportFailed ??= error;
        return null;
      }
    );
    if (reply) reportAnswered = true;
    const student = reply?.students.find(
      (row) => row.roll.trim().toLowerCase() === roll.toLowerCase()
    );
    if (reply && student) {
      // The class report states no dates, so the student's own grid is the only
      // place they exist — read them now, over the same window, the way the
      // panel does for a register row, and walk the semester beside them.
      const absences = await readAbsences(portal, roll, {
        name: student.name,
        register: gridRequest,
      });
      if (absences.absent) student.absent = absences.absent;
      const full = await readFullSemesterAbsences(
        portal,
        roll,
        student.name,
        gridRequest
      );
      return {
        profile,
        class: {
          ...found.levels,
          section,
          semesterInferred: found.semesterInferred,
        },
        window: reply.summary.range,
        student,
        fullAbsent: full.absent,
        fullRange: full.range,
        note: full.note,
      };
    }
  }
  if (!reportAnswered && reportFailed) {
    if (reportFailed instanceof HttpError) throw reportFailed;
    throw new HttpError(
      502,
      "ECAP's class attendance report came back in an unexpected shape, so no figure could be read for this student."
    );
  }
  return {
    profile,
    class: {
      ...found.levels,
      section: null,
      semesterInferred: found.semesterInferred,
    },
    window,
    student: null,
    fullAbsent: null,
    fullRange: null,
    note: `No row for ${roll} in ${found.label} over ${window.from} to ${window.to}.`,
  };
}
/**
 * The semester's first held day, walking back month by month from the asked
 * `to`: the asked month plus up to `steps` before it, each a month-shaped
 * read — the only shape ECAP reliably answers, wide registers come back
 * empty. The first month stating no meeting days stops the walk, and the
 * earliest month stating any names the start. A whole break month with no
 * meetings stops the walk early; accepted, the same trade the semester
 * absences walk makes.
 */
async function walkSemStart(
  portal: PortalReader,
  p: Record<Level, Option>,
  to: string,
  steps: number
): Promise<SemStartReply> {
  const [, tm, ty] = to.split("/").map(Number);
  if (!tm || !ty || tm > 12) throw new HttpError(400, "Choose a date range.");
  let start: string | null = null;
  let year = ty;
  let month = tm;
  for (let step = 0; step <= steps; step++) {
    const window = monthWindow(year, month);
    const startOfMonth = monthStart(
      registerDates(await portal.register({ ...p, ...window })),
      year,
      month
    );
    if (!startOfMonth) break;
    start = startOfMonth;
    ({ year, month } = previousMonth(year, month));
  }
  return { statedFrom: start };
}
/**
 * One subject's earliest held day inside the asked window, for the All subjects
 * path whose own report states no dates at all. Reads that subject's register
 * grid and returns only its first date — never a roster — so the All subjects
 * view can name a start date without fetching a second register. Null where
 * the grid states no dates, which is not a clean sheet; a 401 still propagates
 * so a dead session signs out.
 *
 * With `walkBack` the read walks back instead: the asked month plus up to
 * that many before it, for the settle-time probe that opens From at the
 * semester rather than the month.
 */
export async function handleSemStart(
  portal: PortalReader,
  b: Partial<SemStartRequest>
): Promise<SemStartReply> {
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");
  const p = requireLevels(b);
  const steps = Math.min(Math.max(Math.floor(b.walkBack ?? 0), 0), 12);
  if (!steps) {
    const dates = registerDates(
      await portal.register({ ...p, from: b.from, to: b.to })
    );
    if (!dates.length) return { statedFrom: null };
    return { statedFrom: statedStartDate(dates, { from: b.from, to: b.to }) };
  }
  return walkSemStart(portal, p, b.to, steps);
}
/**
 * One student's absent days over a wider window than the register on screen —
 * the same register read twice (subject path) or the same Student Wise read
 * twice (All subjects path), over the remembered start instead of the typed
 * From. Returns only that student's dates, never a roster, so the panel can
 * name a full-semester list beside the window's own.
 *
 * A student the wider grid never mentions is stated as nothing, not as a clean
 * sheet: the read said nothing about them, which is not a finding. A failing
 * read throws, and the client says so on the panel — except a 401, which ends
 * the session instead.
 */
export async function handleSemAbsences(
  portal: PortalReader,
  b: Partial<SemAbsencesRequest>
): Promise<SemAbsencesReply> {
  const roll = b.roll?.trim();
  if (!roll) throw new HttpError(400, "Choose a student.");
  if (!b.register) throw new HttpError(400, "Open a register first.");
  if (!b.from) throw new HttpError(400, "Choose a date range.");
  const p = requireLevels(b.register);
  const { to } = b.register;
  if (!to) throw new HttpError(400, "Choose a date range.");
  const { from } = b;
  if (isAllSubjects(p.subject)) {
    return await studentWiseAbsent(portal, roll, b.name ?? "", {
      ...p,
      from,
      to,
    });
  }
  const rows = parseRegister(await portal.register({ ...p, from, to }));
  const row = rows.find((r) => r.roll === roll);
  // A student the wider grid does not mention is stated as nothing, never as a
  // clean sheet: the read said nothing about them, which is not a finding.
  return row ? { absent: row.absent } : {};
}
export async function handleFacultyProfile(
  portal: PortalReader
): Promise<FacultyProfile> {
  const profile = await portal.facultyProfile();
  if (!profile.name) {
    throw new HttpError(
      502,
      "ECAP's main page came back without a faculty name, so the profile could not be read."
    );
  }
  return profile;
}
/** Today's timetable: the dashboard's schedule grid, read as written. A grid
 *  stating no periods is an empty day — which ECAP also answers after ~4pm,
 *  when it clears the day — never a failed read. */
export async function handleTodayClasses(
  portal: PortalReader
): Promise<TodayClassesReply> {
  return { classes: parseTodayClasses(await portal.todayClasses()) };
}
/** The day-class-work report for every offered branch today: each section's
 *  periods with their posted flags. The course prefers B.Tech and falls back
 *  to the first offered course, so a faculty outside B.Tech reads their own
 *  branches rather than a named failure; every offered branch travels, and
 *  only semesters the Portal counts into the academic year do — the day
 *  report's own page skips title-less ones the same way. A refusal throws
 *  before the parser is reached, so it says the read failed rather than
 *  passing for all posted. */
export async function handleUnposted(
  portal: PortalReader
): Promise<UnpostedReply> {
  const date = todayIST();
  const { verdict, courses: courseOptions } = await courseVerdict(portal);
  if (verdict === "dead") {
    throw new HttpError(
      401,
      "Your ECAP session expired. Please sign in again."
    );
  }
  if (verdict === "unknown") {
    throw new HttpError(502, "ECAP offered no courses.");
  }
  const courses = realOptions(courseOptions);
  const course = matchOption("B.Tech", courses) ?? courses[0];
  if (!course) {
    throw new HttpError(502, "ECAP offered no courses.");
  }
  const [offered, semesters] = await portal.branchesAndSemesters(course.value);
  const branches = realOptions(offered);
  if (!branches.length) {
    throw new HttpError(502, "ECAP offered no branches.");
  }
  const titled = semesters.filter((s) => s.title);
  if (!titled.length) {
    throw new HttpError(
      502,
      "ECAP counted no semesters into this academic year."
    );
  }
  const shorts: Record<string, string> = Object.fromEntries(
    branches.map((b) => [b.label, b.title || b.label])
  );
  const sections = parseDayClassWork(
    await portal.dayClassWork({
      course,
      branches,
      semesters: titled,
      date,
    }),
    shorts
  );
  return { date, sections };
}
