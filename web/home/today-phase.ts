import type { TodayClass } from "../../shared/api";
import type { Note } from "../app/types";

/**
 * Today's timetable surface as one phase, so a panel that is neither reading
 * nor showing a day cannot be rendered. `classes` is the answer the screen
 * shows, already resolved with the remembered day by `shownToday` — a cleared
 * evening still carries the morning's periods until midnight. The phase only
 * names what that answer means for the surface: a loader while unread, the
 * alert alone for a refusal, and the table for an empty or a stated day.
 */
export type TodayPhase =
  | { kind: "unread" }
  | { kind: "failed" }
  | { kind: "cleared"; classes: readonly TodayClass[] }
  | { kind: "day"; classes: readonly TodayClass[] };

export function todayPhase(input: {
  /** The timetable to show, resolved with the remembered day, or null while
   *  nothing has been read. */
  classes: TodayClass[] | null;
  busy: boolean;
  note: Note | null;
}): TodayPhase {
  if (input.classes !== null) {
    return input.classes.length > 0
      ? { kind: "day", classes: input.classes }
      : { kind: "cleared", classes: input.classes };
  }
  // A refusal is named by its note and renders the alert alone; every other
  // unanswered read — in flight or not yet asked — is the loader, never a
  // blank surface.
  return input.note ? { kind: "failed" } : { kind: "unread" };
}
