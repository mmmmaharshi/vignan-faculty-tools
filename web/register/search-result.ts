import type { FindReply, Student, StudentProfile } from "../../shared/api";
import { messageOf } from "../../shared/portal-values";
import type { Note } from "../app/types";
import type { ApiError } from "../data/client";
import { isExpired } from "../data/client";
import { searchScope } from "./search-scope";
import type { ScopeRow } from "./search-scope";

/**
 * The Student Search answer as one named outcome. Nothing asked, an ask in
 * flight, a refusal, an unstated class, a class without the roll and a class
 * with it are distinct answers. The wire reply is untouched; this is the app's
 * reading of it.
 */
type SearchKind =
  | "idle"
  | "pending"
  | "refused"
  | "no-class"
  | "no-roll"
  | "found";

export type SearchResult = { kind: SearchKind } & SearchShown;

type SearchShown = {
  note: Note | null;
  student: Student | null;
  profile: StudentProfile | null;
  fullAbsent: Array<string> | null;
  scope: Array<ScopeRow> | undefined;
};

export function searchResult(
  error: ApiError | undefined,
  found: FindReply | null,
  loading: boolean
): SearchResult {
  // A 401 has already ended the session through the sweep, so it says nothing
  // here; the reply's own words still stand, as they do on the panel today.
  let note: Note | null = null;
  if (error && !isExpired(error)) {
    note = { kind: "error", text: messageOf(error) };
  } else if (found?.note) {
    note = { kind: "warning", text: found.note };
  }
  const shown: SearchShown = {
    note,
    student: found?.student ?? null,
    profile: found?.profile ?? null,
    fullAbsent: found?.fullAbsent ?? null,
    scope: searchScope(found),
  };
  // An ask in flight owns the screen before any earlier answer or refusal:
  // the panel stays mounted so its loader is what the reader sees.
  if (loading) {
    return { kind: "pending", ...shown };
  }
  if (error) {
    return { kind: "refused", ...shown };
  }
  if (!found) {
    return { kind: "idle", ...shown };
  }
  if (!found.class) {
    return { kind: "no-class", ...shown };
  }
  if (!found.student) {
    return { kind: "no-roll", ...shown };
  }
  return { kind: "found", ...shown };
}
