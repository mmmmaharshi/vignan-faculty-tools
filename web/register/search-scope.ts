import type { FindReply } from "../../shared/api";

/** One labelled row above a searched student's figures. */
export type ScopeRow = { label: string; value: string };

/**
 * The class and window a searched figure belongs to, as labelled rows.
 *
 * A percentage with no period under it invites being read as a semester's, so
 * the window travels with it — and an inferred semester is marked as one, so a
 * guess never prints as a fact. Null where the search found no class: there is
 * nothing to scope, which is not an empty class.
 */
export function searchScope(found: FindReply | null): ScopeRow[] | undefined {
  if (!found?.class) return undefined;
  const { class: found0, window } = found;
  return [
    { label: "Course", value: found0.course.label },
    {
      label: "Semester",
      value: found0.semesterInferred
        ? `${found0.semester.label} (inferred)`
        : found0.semester.label,
    },
    { label: "Branch", value: found0.branch.label },
    ...(found0.section
      ? [{ label: "Section", value: found0.section.label }]
      : []),
    { label: "Window", value: `${window.from} to ${window.to}` },
  ];
}
