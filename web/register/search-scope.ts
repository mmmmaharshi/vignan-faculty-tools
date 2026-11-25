import type { FindReply } from "../../shared/api";

/** One labelled row above a searched student's figures. */
export type ScopeRow = { label: string; value: string };

/**
 * The class and window a searched figure belongs to, as labelled rows.
 *
 * A percentage with no period under it invites being read as a semester's, so
 * the window travels with it — and an inferred semester is marked as one, so a
 * guess never prints as a fact. Where no class resolves, the fields the profile
 * page did state are still shown; no field is invented for one it omitted.
 */
export function searchScope(
  found: FindReply | null
): Array<ScopeRow> | undefined {
  if (!found) {
    return undefined;
  }
  if (found.class) {
    const { class: found0, window } = found;
    const section = found0.section?.label;
    const statedSection = found.statedClass.section;
    return [
      { label: "Course", value: found0.course.label },
      {
        label: "Semester",
        value: found0.semesterInferred
          ? `${found0.semester.label} (inferred)`
          : found0.semester.label,
      },
      { label: "Branch", value: found0.branch.label },
      ...(section
        ? [{ label: "Section", value: section }]
        : statedSection
          ? [{ label: "Section (profile)", value: statedSection }]
          : []),
      { label: "Window", value: `${window.from} to ${window.to}` },
    ];
  }
  const stated = found.statedClass;
  const rows = [
    { label: "Course", value: stated.course },
    { label: "Semester", value: stated.semester },
    { label: "Branch", value: stated.branch },
    { label: "Section (profile)", value: stated.section },
  ].filter((row) => row.value);
  return rows.length ? rows : undefined;
}
