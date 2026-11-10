import {
  ALL_SUBJECTS,
  isAllSubjects,
  sameRoll,
  statedStartDate,
  todayIST,
} from "../shared/api.js";
import type {
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
  StudentMonth,
  StudentTotals,
  TodayClassesReply,
  UnpostedReply,
} from "../shared/api.js";
import type { OverallLookup } from "./attendance-bands.js";
import { summarise } from "./attendance-bands.js";
import { HttpError, rethrowExpired, unreadablePage } from "./http-error.js";
import { parseDayClassWork, parseTodayClasses } from "./portal-daywork.js";
import { requireCourses } from "./portal-liveness.js";
import { matchOption, realOptions } from "./portal-options.js";
import type { Level, PortalReader } from "./portal-reader.js";
import {
  classReportSubjects,
  parseClassAttendance,
  parseCumulativeTotals,
  parseRegister,
  parseStudentAbsences,
  parseSubjectReport,
  registerDates,
  studentWiseDates,
} from "./portal-register.js";
import type { OverallRow } from "./portal-register.js";
import { parseStudentClass, parseStudentProfile } from "./portal-student.js";
import { resolveClass } from "./student-class.js";

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
    const choices = realOptions(list);
    out[key] = choices;
    if (!choices.length) emptyLevels.push(key);
  };
  take("course", await requireCourses(portal));
  if (b.course) {
    const [branches, semesters] = await portal.branchesAndSemesters(b.course);
    take("branch", branches);
    take("semester", semesters);
  }
  if (b.course && b.branch && b.semester) {
    // The batch number travels beside the semester value, and only the Portal's
    // own list states it. It is resolved here from the list just fetched, with
    // the client's value only as a fallback: a client whose cascade has not
    // settled yet sends none, and an unresolved batch asks the wrong section
    // list.
    const batch =
      out.semester.find((o) => String(o.value) === String(b.semester))?.title ||
      b.semesterTitle;
    take(
      "section",
      await portal.sections(b.course, b.branch, b.semester, batch)
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
): Promise<{ rows: OverallRow[]; byRoll: OverallLookup; subjects: string[] }> {
  try {
    const reply = await portal.classAttendance(p);
    const rows = parseClassAttendance(reply);
    return {
      rows,
      byRoll: new Map(
        rows.map((row) => [
          row.roll,
          { attendedOfHeld: row.attendedOfHeld, pct: row.pct },
        ])
      ),
      subjects: classReportSubjects(reply),
    };
  } catch (error) {
    rethrowExpired(error);
    return { rows: [], byRoll: new Map(), subjects: [] };
  }
}
/**
 * The subject list the SUBJECT ATTENDANCE page offers for one class, or null
 * where ECAP will not give it. Null is not an empty class: the caller still
 * names the columns the class report states, and every cell stays a dash.
 */
async function listOfferedSubjects(
  portal: PortalReader,
  p: Record<Level, Option>
): Promise<Option[] | null> {
  try {
    return realOptions(
      await portal.subjectOptions(
        p.course.value,
        p.branch.value,
        p.semester.value
      )
    );
  } catch (error) {
    rethrowExpired(error);
    return null;
  }
}
/**
 * One subject's stated percentages, keyed by roll: the All subjects view
 * names its columns from the class report, but the figures come from each
 * subject's own report, read in parallel. A column whose subject the
 * Portal's own subject list does not offer is dropped rather than guessed;
 * a subject ECAP will not answer leaves dashes rather than failing the
 * register; a dead session still signs out.
 */
async function readSubjectPercents(
  portal: PortalReader,
  p: Record<Level, Option> & { from: string; to: string },
  columns: string[],
  offered: Option[] | null
): Promise<{
  labels: string[];
  byColumn: Map<string, Map<string, number | null>>;
}> {
  if (offered === null) {
    // The listing itself failed: name the columns the class report states,
    // with no figures rather than no columns — the same dash a failed
    // subject report earns.
    return { labels: columns, byColumn: new Map() };
  }
  const pairs = columns
    .map((label) => ({ label, subject: matchOption(label, offered) }))
    .filter(
      (pair): pair is { label: string; subject: Option } =>
        pair.subject !== null
    );
  const byColumn = new Map<string, Map<string, number | null>>();
  await Promise.all(
    pairs.map(async ({ label, subject }) => {
      try {
        const grid = parseSubjectReport(await portal.subjectReport(p, subject));
        byColumn.set(
          label,
          new Map(grid.map((row) => [row.roll, row.pct] as const))
        );
      } catch (error) {
        rethrowExpired(error);
      }
    })
  );
  return { labels: pairs.map((pair) => pair.label), byColumn };
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
    // The report and the subject listing need nothing from each other, so
    // they go out together; the per-subject reads wait for both.
    const [{ rows, byRoll, subjects: columns }, offered] = await Promise.all([
      readOverall(portal, { ...p, from, to }),
      listOfferedSubjects(portal, p),
    ]);
    if (!rows.length) {
      throw new HttpError(
        502,
        "The class attendance report came back empty. Either the section has no classes in that date range, or ECAP's page layout has changed."
      );
    }
    // Each column's percentages come from that subject's own report, read in
    // parallel: the class report states counts, never percentages.
    const { labels: subjectColumns, byColumn: pctByColumn } =
      await readSubjectPercents(portal, { ...p, from, to }, columns, offered);
    return summarise(
      rows.map((row) => ({
        sl: row.sl,
        roll: row.roll,
        name: row.name,
        attendedOfHeld: "",
        pct: null,
        subjects: subjectColumns.map(
          (column) => pctByColumn.get(column)?.get(row.roll) ?? null
        ),
        absent: [],
      })),
      range,
      byRoll,
      null,
      null,
      [],
      subjectColumns
    );
  }
  // The grid and the class-wide report need nothing from each other, so
  // both go out together. An empty register still fails as an empty
  // register even when the class report fails beside it, so the two answers
  // are settled separately and read in the old order. A dead session still
  // surfaces as a 401 either way.
  const [registerSettled, overallSettled] = await Promise.allSettled([
    portal.register({ ...p, from, to }),
    readOverall(portal, { ...p, from, to }),
  ]);
  if (registerSettled.status === "rejected") throw registerSettled.reason;
  const rows = parseRegister(registerSettled.value);
  if (!rows.length) {
    throw new HttpError(
      502,
      "The register came back empty. Either the subject has no classes in that date range, or ECAP's page layout has changed."
    );
  }
  if (overallSettled.status === "rejected") throw overallSettled.reason;
  const { byRoll } = overallSettled.value;
  // The grid's own date columns are the working-days count: a grid that
  // states none leaves the summary bare rather than printing a zero. The
  // first one is where the figures begin, so the input can snap to it.
  const dates = registerDates(registerSettled.value);
  return summarise(
    rows,
    range,
    byRoll,
    dates.length || null,
    statedStartDate(dates, range),
    dates
  );
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
/** How many months one walk may read before it gives up. The two semester
 *  walks use it as a limit on how far back they look; the month table uses it
 *  as a limit on how many rows it will ask for. One number, because all three
 *  are answering "how far can this go before it is not a semester any more". */
const MONTH_WALK_CAP = 12;
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
/** The month after, across a year boundary. */
function nextMonth(
  year: number,
  month: number
): { year: number; month: number } {
  return month < 12 ? { year, month: month + 1 } : { year: year + 1, month: 1 };
}
/**
 * One row per month, from the semester's first month through the current one.
 *
 * The dates label the month itself — its first day, or the semester start when
 * the term began mid-month, through its last day or today. The percentage the
 * row carries is cumulative from the semester start, which is what a monthly
 * counselling report quotes: each row's figure includes the months above it.
 * Empty when either date will not parse, so the panel shows no table rather than
 * one built from a guess.
 */
function monthToDateWindows(semStart: string, now: string): StudentMonth[] {
  const [sd, sm, sy] = semStart.split("/").map(Number);
  const [, nm, ny] = now.split("/").map(Number);
  if (!sd || !sm || !sy || !nm || !ny || sm > 12 || nm > 12) return [];
  // How many months the semester spans, both ends counted.
  const span = (ny - sy) * 12 + (nm - sm) + 1;
  if (span < 1) return [];
  // A span longer than the cap keeps its newest rows: the table exists to show
  // where the student stands now, so a stale start drops old months rather than
  // stopping short of the month in progress.
  let year = sy;
  let month = sm;
  for (let skipped = 0; skipped < span - MONTH_WALK_CAP; skipped++) {
    ({ year, month } = nextMonth(year, month));
  }
  const out: StudentMonth[] = [];
  for (let step = 0; step < Math.min(span, MONTH_WALK_CAP); step++) {
    const running = year === ny && month === nm;
    const opening = monthWindow(year, month).from;
    out.push({
      // The term's first month opens on the day the semester did, not on the 1st.
      from: year === sy && month === sm ? semStart : opening,
      to: running ? now : monthWindow(year, month).to,
      pct: null,
    });
    ({ year, month } = nextMonth(year, month));
  }
  return out;
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
  for (let step = 0; step < MONTH_WALK_CAP; step++) {
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
 * The semester's held / attended / absent counts, from the Cumulative
 * student-wise register — asked over the semester start through today, the same
 * window that screen uses. Only when the start is known: a guessed window would
 * print figures for a period nobody chose. A reply ECAP will not give is no
 * totals, not a failed panel, and a 401 still ends the session.
 *
 * This is the one place a figure is counted rather than read: ECAP states the
 * three totals as empty spans and fills them in the page, so the grid's own
 * colour-coded marks are the only copy of them a server can reach. ADR 0026
 * records why that exception is narrow to this screen.
 */
async function readTotals(
  portal: PortalReader,
  roll: string,
  b: Partial<StudentRequest>
): Promise<{ totals?: StudentTotals }> {
  const { register, semStart } = b;
  if (!register || !semStart) return {};
  try {
    const html = await portal.studentCumulative(roll, b.name ?? "", {
      ...requireLevels(register),
      from: semStart,
      to: todayIST(),
    });
    const totals = parseCumulativeTotals(html);
    return totals ? { totals } : {};
  } catch (error) {
    rethrowExpired(error);
    return {};
  }
}
/**
 * How long the month table may take before the panel answers without it. The
 * rest of the panel has already arrived by then, and a month still in flight is
 * the blank row a refused month already earns — not a reason to hold the GPA and
 * the phone numbers back, and not a reason to run the function into its own
 * timeout.
 */
const MONTHS_BUDGET_MS = 15_000;
/**
 * `work` if it finishes inside `ms`, else null. A deadline is a timer, and a
 * timer is the only way to bound a wait — the promise raced here is left
 * running, and `Promise.race` already holds a handler for it, so a late refusal
 * cannot surface as an unhandled rejection.
 */
function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    // oxlint-disable-next-line promise/avoid-new -- a deadline is a timer; there is no promise to await instead
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}
/**
 * One student's cumulative attendance month by month, from the semester's first
 * month through the current one: each row is the class report over
 * [semester start → that month's end], so the figure a monthly counselling
 * report quotes is the one ECAP states rather than one this app derived.
 *
 * Needs the open register for the five levels and the known semester start for
 * the window; without either there is no section to read, so the panel says
 * nothing instead of guessing one. Every month is asked in parallel because
 * they need nothing from each other. A month ECAP refuses leaves that row's
 * figure blank — the rest of the table is still a finding — while a 401 still
 * ends the session. ADR 0029 records the cost.
 */
async function readMonths(
  portal: PortalReader,
  roll: string,
  b: Partial<StudentRequest>
): Promise<{ months?: StudentMonth[] }> {
  const { register, semStart } = b;
  if (!register || !semStart) return {};
  const windows = monthToDateWindows(semStart, todayIST());
  if (!windows.length) return {};
  const levels = requireLevels(register);
  const work = Promise.all(
    windows.map(async (month) => {
      try {
        // Cumulative: every row is asked from the semester start, even though
        // its dates label only the month it reports.
        const report = await portal.classAttendance({
          ...levels,
          from: semStart,
          to: month.to,
        });
        const row = parseClassAttendance(report).find((r) =>
          sameRoll(r.roll, roll)
        );
        return row ? { ...month, pct: row.pct } : month;
      } catch (error) {
        rethrowExpired(error);
        return month;
      }
    })
  );
  // After the budget nobody is waiting; `within` holds the handler.
  const months = await within(work, MONTHS_BUDGET_MS);
  return months ? { months } : { months: windows };
}
/**
 * One student's GPA and phone numbers, read on demand when their row is opened.
 * The register states neither, so the Portal is asked about a single student here
 * and nowhere else — except on the All subjects path, where `readAbsences` asks
 * for one more thing, that student's own grid, because the report on screen states
 * no dates at all — and on every path, where `readTotals` asks for the
 * semester's class counts and `readMonths` for one class report per month.
 */
export async function handleStudentProfile(
  portal: PortalReader,
  b: Partial<StudentRequest>
): Promise<StudentProfile> {
  const roll = b.roll?.trim();
  if (!roll) throw new HttpError(400, "Choose a student.");
  // The GPA page, the absent-dates read, the semester's totals and the month
  // table need nothing from each other — the roll, the name and the open
  // register all arrive in the request — so they go out together. A 401 from
  // any still ends the session, and a page that is not the profile still fails
  // named instead of half-read.
  const [page, absences, totals, monthly] = await Promise.all([
    portal.studentProfile(roll),
    readAbsences(portal, roll, b),
    readTotals(portal, roll, b),
    readMonths(portal, roll, b),
  ]);
  const profile = parseStudentProfile(page);
  if (!profile) {
    throw unreadablePage("student profile page");
  }
  return { ...profile, ...absences, ...totals, ...monthly };
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
    throw unreadablePage("student profile page");
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
    const student = reply?.students.find((row) => sameRoll(row.roll, roll));
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
      // The semester's class counts, over the same start the absent walk found —
      // the window ECAP's Cumulative screen uses. The Search screen has no
      // register picker, so this is the only place its panel can get them.
      const asked = {
        name: student.name,
        register: gridRequest,
        semStart: full.range?.from ?? window.from,
      };
      const totals = await readTotals(portal, roll, asked);
      // The same panel reads the same month table here: the section and the
      // semester start are both known by now, so a search must not show less
      // than the register's panel does.
      const monthly = await readMonths(portal, roll, asked);
      return {
        profile: { ...profile, ...totals, ...monthly },
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
  const steps = Math.min(
    Math.max(Math.floor(b.walkBack ?? 0), 0),
    MONTH_WALK_CAP
  );
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
  const row = rows.find((r) => sameRoll(r.roll, roll));
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
  const courses = realOptions(await requireCourses(portal));
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
