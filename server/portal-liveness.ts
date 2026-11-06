import type { Option } from "../shared/api.js";
import { HttpError, sessionExpired } from "./http-error.js";
import { realOptions } from "./portal-options.js";

export type Liveness = "alive" | "dead" | "unknown";
export type CourseReader = {
  courses: () => Promise<Option[]>;
};
/**
 * Is this ECAP session still working? A signed-out request to the course list
 * answers HTTP 200 with valid JSON whose `<select>` holds only `-Select-`, so
 * the check is not "did it throw" — and every account has at least one course,
 * so an empty list can only mean the session is gone. A throw that is not a 401
 * is genuinely ambiguous, which is why `unknown` is a verdict of its own.
 */
export async function courseVerdict(
  portal: CourseReader
): Promise<{ verdict: Liveness; courses: Option[] }> {
  try {
    const courses = await portal.courses();
    return {
      verdict: realOptions(courses).length ? "alive" : "dead",
      courses,
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return { verdict: "dead", courses: [] };
    }
    return { verdict: "unknown", courses: [] };
  }
}
/**
 * The course list, or the refusal its verdict earns. Both halves of the API
 * that start from the course list ask this, so the 401, the 502 and their
 * sentences live once.
 */
export async function requireCourses(portal: CourseReader): Promise<Option[]> {
  const { verdict, courses } = await courseVerdict(portal);
  if (verdict === "dead") throw sessionExpired();
  if (verdict === "unknown") {
    throw new HttpError(502, "ECAP did not answer the course list. Try again.");
  }
  return courses;
}
