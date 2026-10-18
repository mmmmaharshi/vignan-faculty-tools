import type { OverallLookup } from "./attendance-bands";
import { statedStartDate, summarise } from "./attendance-bands";
import { courseVerdict } from "./portal-liveness";
import {
  HttpError,
  level,
  parseClassAttendance,
  parseRegister,
  parseStudentAbsences,
  parseStudentProfile,
  realOptions,
  registerDates,
} from "./portal-replies";
import type { OverallRow } from "./portal-replies";
import { ALL_SUBJECTS, isAllSubjects } from "./shared/api";
import type {
  CascadeLevel,
  FacultyProfile,
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  StudentProfile,
  StudentRequest,
} from "./shared/api";

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
async function readAbsences(
  portal: PortalReader,
  roll: string,
  b: Partial<StudentRequest>
): Promise<{ absent?: string[] }> {
  const { register } = b;
  if (!register || !isAllSubjects(register.subject)) return {};
  try {
    const absent = parseStudentAbsences(
      await portal.studentWise(roll, b.name ?? "", {
        ...requireLevels(register),
        from: register.from,
        to: register.to,
      })
    );
    return absent ? { absent } : {};
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
