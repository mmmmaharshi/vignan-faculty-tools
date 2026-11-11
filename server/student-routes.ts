/** Everything one roll number is asked for: the profile page, the absent days
 *  the register on screen cannot state, the semester's counts, the month table,
 *  and the class a search resolves to. */
import { ALL_SUBJECTS, isAllSubjects } from "../shared/api.js";
import type {
  FindReply,
  FindRequest,
  Option,
  SemAbsencesReply,
  SemAbsencesRequest,
  StudentMonth,
  StudentProfile,
  StudentRequest,
  StudentTotals,
} from "../shared/api.js";
import { sameRoll, todayIST } from "../shared/portal-values.js";
import { handleRegister } from "./class-routes.js";
import { HttpError, rethrowExpired, unreadablePage } from "./http-error.js";
import {
  MONTH_WALK_CAP,
  monthStart,
  monthWindow,
  nextMonth,
  previousMonth,
} from "./month-windows.js";
import type { Level, PortalReader } from "./portal-reader.js";
import {
  parseClassAttendance,
  parseCumulativeTotals,
  parseRegister,
  parseStudentAbsences,
  studentWiseDates,
} from "./portal-register.js";
import { parseStudentClass, parseStudentProfile } from "./portal-student.js";
import { requireLevels } from "./register-levels.js";
import { resolveClass } from "./student-class.js";

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
    const opening = monthWindow(year, month);
    out.push({
      // The term's first month opens on the day the semester did, not on the 1st.
      from: year === sy && month === sm ? semStart : opening.from,
      to: running ? now : opening.to,
      pct: null,
    });
    ({ year, month } = nextMonth(year, month));
  }
  return out;
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
