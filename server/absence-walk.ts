/**
 * The full-semester absences walk, as named outcomes instead of a nullable
 * range, a nullable list, a loop flag and a reason string beside them. The walk
 * reads one month at a time until a month states no meeting days, a month is
 * refused, or the twelve-month cap is reached; each way it ends is its own
 * answer, and the caller narrows once to the three fields the reply carries.
 */

export type AbsenceStep =
  | { kind: "read"; start: string; days: string[] }
  | { kind: "dateless" }
  | { kind: "refused" };

export type AbsenceWalk =
  | { kind: "walking"; perMonth: string[][]; start: string | null }
  | { kind: "unparseable" }
  | { kind: "dateless"; perMonth: string[][]; start: string | null }
  | { kind: "refused"; perMonth: string[][]; start: string | null }
  | { kind: "capped"; perMonth: string[][]; start: string };

export const walking: AbsenceWalk = {
  kind: "walking",
  perMonth: [],
  start: null,
};

/** A walk that has ended ignores every later step: it asks ECAP nothing more. */
export function advance(walk: AbsenceWalk, step: AbsenceStep): AbsenceWalk {
  if (walk.kind !== "walking") return walk;
  if (step.kind === "dateless") {
    return { kind: "dateless", perMonth: walk.perMonth, start: walk.start };
  }
  if (step.kind === "refused") {
    return { kind: "refused", perMonth: walk.perMonth, start: walk.start };
  }
  // Months are walked backwards, so each read is prepended: the list the
  // panel shows runs oldest first, and `start` ends as the oldest month.
  return {
    kind: "walking",
    perMonth: [step.days, ...walk.perMonth],
    start: step.start,
  };
}

/** The walk read its fill of months without a dateless month or a refusal. */
export function endAtCap(walk: AbsenceWalk): AbsenceWalk {
  if (walk.kind !== "walking") return walk;
  return walk.start
    ? { kind: "capped", perMonth: walk.perMonth, start: walk.start }
    : { kind: "dateless", perMonth: walk.perMonth, start: null };
}

const REFUSAL_NOTE =
  "ECAP would not give every month's absent days, so the full-semester list below may be incomplete.";
const CAP_NOTE =
  "ECAP kept stating meeting days twelve months back, so the semester may have started earlier than shown.";

/** The one place a walk becomes what the caller puts in the reply. */
export function absenceResult(
  walk: AbsenceWalk,
  to: string
): {
  absent: string[] | null;
  range: { from: string; to: string } | null;
  note: string;
} {
  const range = (from: string): { from: string; to: string } => ({ from, to });
  if (walk.kind === "unparseable" || walk.kind === "walking") {
    return { absent: null, range: null, note: "" };
  }
  if (walk.kind === "dateless") {
    return walk.start
      ? { absent: walk.perMonth.flat(), range: range(walk.start), note: "" }
      : { absent: null, range: null, note: "" };
  }
  if (walk.kind === "refused") {
    return {
      absent: walk.perMonth.length ? walk.perMonth.flat() : null,
      range: walk.start ? range(walk.start) : null,
      note: REFUSAL_NOTE,
    };
  }
  return {
    absent: walk.perMonth.flat(),
    range: range(walk.start),
    note: CAP_NOTE,
  };
}
