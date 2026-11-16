/**
 * The class a Student Search profile resolves to, as one named outcome instead
 * of a value that is either a class or a reason string. The inferred-semester
 * flag is carried by the branch that chose the semester, so a stated semester
 * cannot be printed as a guess or an inferred one as a fact.
 */
import type { Option } from "../shared/api.js";

export type ResolvedClass = {
  levels: Record<"course" | "semester" | "branch", Option>;
  sections: Option[];
  label: string;
  /** True when the semester came from the SGPA guess rather than the page. */
  semesterInferred: boolean;
};

export type ClassSemester =
  | { kind: "stated"; option: Option }
  | { kind: "inferred"; option: Option };

export type ClassResolution =
  | { kind: "resolved"; value: ResolvedClass }
  | { kind: "unstated"; reason: string };

/** The page either states a value the Portal will not offer, or states none. */
export const unstatedReason = (what: string, stated: string): string =>
  stated
    ? `ECAP's profile page states the ${what} "${stated}", which the Portal's own list does not offer.`
    : `ECAP's profile page does not state a ${what}, so no class register can be read for this student.`;

/** The last step of the resolver: sections or a human reason, never both. */
export function classResolution(input: {
  course: Option;
  branch: Option;
  semester: ClassSemester;
  sections: Option[];
  noSectionsReason: string;
}): ClassResolution {
  if (!input.sections.length) {
    return { kind: "unstated", reason: input.noSectionsReason };
  }
  return {
    kind: "resolved",
    value: {
      levels: {
        course: input.course,
        branch: input.branch,
        semester: input.semester.option,
      },
      sections: input.sections,
      label: `${input.course.label} · ${input.semester.option.label} · ${input.branch.label}`,
      semesterInferred: input.semester.kind === "inferred",
    },
  };
}
