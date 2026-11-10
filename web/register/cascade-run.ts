import type { OptionsReply, OptionsRequest } from "../../shared/api";
import {
  LEVEL_KEYS,
  applyOptions,
  semesterTitleOf,
  shouldContinue,
} from "./cascade";
import type { Sel } from "./cascade";

/**
 * One run of the option loop, with every request it makes and everything it
 * settled. The loop is the caller's because the chain is sequential: a pass is
 * built from the reply to the pass before it, so no cache can compute it ahead.
 */
export type CascadeOutcome = {
  sel: Sel;
  opts: OptionsReply;
};
export type CascadeSetup = {
  /** The selection to settle, already cleared by `selectionAfter`. */
  seed: Sel;
  /** The options the screen already holds. One thing a level's own value cannot
   *  state is the semester's title, which the Portal wants beside it as the batch
   *  number, so a run that starts with a semester chosen reads it here. */
  known: OptionsReply;
  /** Aborted when the screen stops wanting this run — a newer change, or a session
   *  that ended. The run then stops asking the Portal and answers null. */
  signal?: AbortSignal;
};
/**
 * Settles the cascade: asks for options until a pass gains nothing and no level
 * below a chosen one is still empty, and answers the selection and the last
 * reply.
 *
 * The fetcher is an argument rather than an import so the loop can be driven
 * without a server, the way `createApi` takes its way of reaching ECAP. It is
 * never given `signal`: an aborted run stops *between* passes, so nothing here
 * rejects with an abort the caller would have to tell apart from a failure.
 */
/**
 * The progress a failed run had made when it failed, read off the error it
 * threw. The screen shows what arrived beside the failure rather than five
 * empty selects, and a retry settles from there. Null where the run failed
 * before anything arrived — a first pass failing leaves nothing to keep,
 * which is the old behaviour exactly.
 */
export function partialOf(error: unknown): CascadeOutcome | null {
  if (typeof error !== "object" || error === null) return null;
  return (error as { partial?: CascadeOutcome }).partial ?? null;
}
/**
 * Whether asking again could change the answer: anything but a judged
 * client error. A refused session (401) and its 4xx siblings were already
 * judged — re-asking cannot change the answer, and the 401 must reach the
 * sign-out sweep at once. Anything else (a 5xx, a network failure, a throw
 * with no status at all) may be transient. Structural on purpose: the loop
 * is driven by the client's error class in the app and by fakes in tests.
 */
export function isRetriable(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (!("status" in error) || typeof error.status !== "number") return true;
  return error.status >= 500;
}
/**
 * One pass, asked at most twice: a stumble is re-asked once, a judged
 * failure and a superseded run are answered at once. Aborts are never
 * retried — a run the screen stopped wanting asks the Portal nothing more —
 * and the caller still sees a superseded run as `null` via its own check.
 */
async function fetchWithOneRetry(
  fetchOptions: (request: OptionsRequest) => Promise<OptionsReply>,
  request: OptionsRequest,
  signal?: AbortSignal
): Promise<OptionsReply> {
  try {
    return await fetchOptions(request);
  } catch (error) {
    if (!isRetriable(error) || signal?.aborted) throw error;
    return fetchOptions(request);
  }
}
export async function runCascade(
  setup: CascadeSetup,
  fetchOptions: (request: OptionsRequest) => Promise<OptionsReply>
): Promise<CascadeOutcome | null> {
  const { seed, known, signal } = setup;
  let draft = { ...seed };
  let opts = known;
  try {
    for (const _pass of LEVEL_KEYS) {
      if (signal?.aborted) return null;
      const semesterTitle = draft.semester
        ? semesterTitleOf(opts, draft.semester) || undefined
        : undefined;
      const before = draft;
      const reply = await fetchWithOneRetry(
        fetchOptions,
        {
          course: draft.course || undefined,
          semester: draft.semester || undefined,
          semesterTitle,
          branch: draft.branch || undefined,
          section: draft.section || undefined,
        },
        signal
      );
      if (signal?.aborted) return null;
      draft = applyOptions(draft, reply);
      opts = reply;
      if (!shouldContinue(draft, before, reply)) break;
    }
  } catch (error) {
    // The same error the run would have thrown, carrying what arrived: its
    // status and message still decide the sign-out sweep and the alert, so
    // neither is wrapped nor renamed — the screen just keeps the settled
    // levels beside the failure instead of discarding them with the run.
    if (typeof error === "object" && error !== null) {
      (error as { partial?: CascadeOutcome }).partial = {
        sel: { ...draft },
        opts,
      };
    }
    throw error;
  }
  return { sel: draft, opts };
}
