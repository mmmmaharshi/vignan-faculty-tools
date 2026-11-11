/** The three reads that name neither one class nor one student: the signed-in
 *  faculty's own profile, today's timetable, and the day-class-work report. */
import type {
  FacultyProfile,
  TodayClassesReply,
  UnpostedReply,
} from "../shared/api.js";
import { todayIST } from "../shared/portal-values.js";
import { HttpError } from "./http-error.js";
import { parseDayClassWork, parseTodayClasses } from "./portal-daywork.js";
import { requireCourses } from "./portal-liveness.js";
import { matchOption, realOptions } from "./portal-options.js";
import type { PortalReader } from "./portal-reader.js";

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
