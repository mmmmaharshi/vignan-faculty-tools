import { ALL_SUBJECTS, isAllSubjects } from "../shared/api.js";
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
  StudentProfile,
  StudentRequest,
} from "../shared/api.js";
import type { OverallLookup } from "./attendance-bands.js";
import { statedStartDate, summarise } from "./attendance-bands.js";
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
  realOptions,
  registerDates,
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
    if (error instanceof HttpError && error.status === 401) throw error;
    return {};
  }
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
/** The class a student's own page puts them in, matched to the Portal's own
 *  option values, and the sections that class offers. A page that states a
 *  section names one section; one that states none names all of them, and the
 *  search reads each until the roll turns up. */
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
 *  states: the highest completed, plus one. Zero completed means the first
 *  semester. A guess, and it can be wrong for a repeater — see ADR 0025. */
function inferSemester(profile: StudentProfile): number {
  const done = profile.sgpa
    .map((s) => semesterNumber(s.semester))
    .filter((n): n is number => n !== null);
  return (done.length ? Math.max(...done) : 0) + 1;
}
type StudentClass = {
  levels: Record<"course" | "semester" | "branch", Option>;
  sections: Option[];
  label: string;
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
  if (stated.semester) {
    semester = matchOption(stated.semester, semesters);
    if (!semester) return unstated("semester", stated.semester);
  } else {
    // The page states no semester; infer the current one from the SGPAs it
    // does state — the highest completed, plus one. A guess, and it can be
    // wrong for a repeater; the only way to be sure is to ask (option 3).
    const inferred = inferSemester(profile);
    semester =
      semesters.find((o) => semesterNumber(o.label) === inferred) ?? null;
    if (!semester) {
      return `ECAP's profile page does not state a semester, and the one inferred from its SGPA list (${inferred}) is not one the Portal offers.`;
    }
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
  const window = { from: b.from, to: b.to };
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
    return { profile, class: null, window, student: null, note: found };
  }
  for (const section of found.sections) {
    const reply = await handleRegister(portal, {
      ...found.levels,
      section,
      subject: ALL_SUBJECTS,
      ...window,
    }).catch((error: unknown) => {
      // A dead session must still sign out. Anything else is one section this
      // search can do without: the next one may hold the roll.
      if (error instanceof HttpError && error.status === 401) throw error;
      return null;
    });
    const student = reply?.students.find(
      (row) => row.roll.trim().toLowerCase() === roll.toLowerCase()
    );
    if (reply && student) {
      // The class report states no dates, so the student's own grid is the only
      // place they exist — read them now, over the same window, the way the
      // panel does for a register row.
      const absences = await readAbsences(portal, roll, {
        name: student.name,
        register: {
          ...found.levels,
          section,
          subject: ALL_SUBJECTS,
          from: window.from,
          to: window.to,
        },
      });
      if (absences.absent) student.absent = absences.absent;
      return {
        profile,
        class: { ...found.levels, section },
        window: reply.summary.range,
        student,
        note: "",
      };
    }
  }
  return {
    profile,
    class: { ...found.levels, section: null },
    window,
    student: null,
    note: `No row for ${roll} in ${found.label} over ${window.from} to ${window.to}.`,
  };
}
/**
 * One subject's earliest held day inside the asked window, for the All subjects
 * path whose own report states no dates at all. Reads that subject's register
 * grid and returns only its first date — never a roster — so the All subjects
 * view can name a start date without fetching a second register. Null where
 * the grid states no dates, which is not a clean sheet; a 401 still propagates
 * so a dead session signs out.
 */
export async function handleSemStart(
  portal: PortalReader,
  b: Partial<RegisterRequest>
): Promise<SemStartReply> {
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");
  const p = requireLevels(b);
  const dates = registerDates(
    await portal.register({ ...p, from: b.from, to: b.to })
  );
  if (!dates.length) return { statedFrom: null };
  return { statedFrom: statedStartDate(dates, { from: b.from, to: b.to }) };
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
