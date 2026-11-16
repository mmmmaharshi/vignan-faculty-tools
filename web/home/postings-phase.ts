import type { DayWorkCell, DayWorkSection } from "../../shared/api";
import type { Note } from "../app/types";

/**
 * The pending-postings surface as one phase, so it is never neither showing
 * data nor loading. A refusal stays in this surface's own note and never
 * fails the timetable above it. The branch on show is decided here from the
 * report, so no calling site can guess one the report did not name.
 */
export type PostingsPhase =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "none" }
  | { kind: "report"; sections: readonly DayWorkSection[] };

export function postingsPhase(input: {
  sections: DayWorkSection[] | null;
  busy: boolean;
  note: Note | null;
}): PostingsPhase {
  if (input.sections !== null) {
    return input.sections.length > 0
      ? { kind: "report", sections: input.sections }
      : { kind: "none" };
  }
  // A refusal has already said so in this section's own alert. Every other
  // unanswered read shows the loader rather than a blank surface.
  return input.note ? { kind: "failed" } : { kind: "loading" };
}

/** Branches the report names, in first-seen order. */
export function reportBranches(
  sections: readonly DayWorkSection[] | null | undefined
): string[] {
  const out: string[] = [];
  for (const section of sections ?? []) {
    if (!out.includes(section.branch)) out.push(section.branch);
  }
  return out;
}

/** The branch on show: the one asked for while the report still offers it,
 *  else the first the report names. Never a branch the report did not name. */
export function shownBranch(
  sections: readonly DayWorkSection[] | null | undefined,
  branch: string | null
): string | null {
  const branches = reportBranches(sections);
  return branch && branches.includes(branch) ? branch : (branches[0] ?? null);
}

/** A period box's detail, as one typed status rather than a plain string. */
export type SlotStatus = "posted" | "not-posted" | "no-class";

export function slotStatus(cell: DayWorkCell | null): SlotStatus {
  if (cell == null) return "no-class";
  return cell.posted ? "posted" : "not-posted";
}

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  posted: "Posted",
  "not-posted": "Not posted yet",
  "no-class": "No class stated",
};
