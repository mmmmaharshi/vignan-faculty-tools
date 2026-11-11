import type { Option, StudentProfile } from "../shared/api.js";
import { matchOption } from "../shared/portal-values.js";
import type { PortalReader } from "./portal-reader.js";
import type { StatedClass } from "./portal-student.js";

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
/** The class a student's own page puts them in, matched to the Portal's own
 *  option values, and the sections that class offers. A page that states a
 *  section names one section; one that states none names all of them, and the
 *  search reads each until the roll turns up. A string is the reason there is
 *  no class, which is an answer rather than a failure. */
export async function resolveClass(
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
    // wrong for a repeater; the only way to be sure is to ask.
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
