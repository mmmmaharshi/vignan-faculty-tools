/**
 * The two states of the backlogs cell cursor: a header is expected next, or
 * the subjects of the row just opened are expected next. The page never closes
 * its data row, so cells are read in order and one boolean used to carry that
 * expectation; naming the states keeps the rule in one decision.
 */

const BACKLOG_TOTAL = /Total backlogs:\s*(?<count>\d+)/i;
const BACKLOG_SEMESTER = /^(?:I|II|III|IV|V|VI|VII|VIII)\s+Semester$/i;

export type BacklogCursor =
  | { kind: "awaiting-semester" }
  | { kind: "awaiting-subjects" };

export const startCursor: BacklogCursor = { kind: "awaiting-semester" };

export type BacklogTransition =
  | { kind: "stop"; total: number; cursor: BacklogCursor }
  | { kind: "open-row"; cursor: BacklogCursor }
  | { kind: "fill-subjects"; cursor: BacklogCursor }
  | { kind: "ignore"; cursor: BacklogCursor };

/** What one cell means, and where the cursor stands after reading it. */
export function backlogStep(
  cursor: BacklogCursor,
  text: string
): BacklogTransition {
  const total = BACKLOG_TOTAL.exec(text);
  if (total) {
    return { kind: "stop", total: Number(total.groups?.count), cursor };
  }
  if (BACKLOG_SEMESTER.test(text)) {
    return { kind: "open-row", cursor: { kind: "awaiting-subjects" } };
  }
  return cursor.kind === "awaiting-subjects"
    ? { kind: "fill-subjects", cursor: { kind: "awaiting-semester" } }
    : { kind: "ignore", cursor };
}
