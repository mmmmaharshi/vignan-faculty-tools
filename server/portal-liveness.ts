import type { Option } from "../shared/api.js";
import { HttpError, realOptions } from "./portal-replies.js";

export type Liveness = "alive" | "dead" | "unknown";
export type CourseReader = {
  courses: () => Promise<Option[]>;
};
async function askPortal(
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
export async function liveness(portal: CourseReader): Promise<Liveness> {
  const { verdict } = await askPortal(portal);
  return verdict;
}
export function courseVerdict(
  portal: CourseReader
): Promise<{ verdict: Liveness; courses: Option[] }> {
  return askPortal(portal);
}
