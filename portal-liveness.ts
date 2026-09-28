/**
 * Is the ECAP session still alive?
 *
 * ## Why this is its own module
 *
 * The answer was being worked out in two places, in two different layers, and only
 * one of them was reachable by a test that does not need the network. `handleOptions`
 * reached it through `take` → `level(realOptions())` → an empty `course`; the
 * `/api/session` probe hand-wrote the same check beside the one that mattered. Two
 * statements of one fact, and the one with zero coverage was the one that shipped the
 * bug.
 *
 * It lives here because it is a *decision* — the one kind of thing that must be
 * importable without booting a server, since importing `server.ts` binds the port
 * and the credential-free suite depends on being able to reach decisions.
 *
 * ## The three answers, and why there are three
 *
 * A signed-out request to the portal's first calling convention does not fail. It
 * answers **HTTP 200 with valid JSON** whose `<select>` holds only the `-Select-`
 * placeholder. Measured against the live portal: a session 19 minutes old returns
 * the real course, one 22 minutes old returns the empty select, which is ECAP's own
 * timeout. So the failure that matters is the one where every sign of life looks
 * good, and that is why the check is not "did it throw".
 *
 * | Reply | Verdict | Why |
 * |---|---|---|
 * | 200, at least one real option | `alive` | the portal is serving this session |
 * | 200, no real option | `dead` | every account has ≥1 course, so an empty list is a gone session |
 * | 401 | `dead` | the second convention checks its reply for HTML and answers 401 |
 * | 502, or anything else | `unknown` | genuinely ambiguous — see below |
 *
 * **`unknown` never means dead.** A 502 could equally be the portal down, or markup
 * that has moved. Signing a user out on it would turn a transient outage into a lost
 * session, which is the trade ADR 0002 already refused when it chose `emptyLevels`
 * over a 502, and ADR 0013 refused again for the probe. Both refusals are for this
 * same reason, and they are recorded rather than re-litigated.
 *
 * Reporting `unknown` rather than folding it into `alive` is what keeps that decision
 * visible: a caller has to say what it does about the case it cannot resolve.
 */
import { HttpError, realOptions } from "./portal-replies";
import type { Option } from "./shared/api";

/** What the portal will tell you about a session. `unknown` is deliberately not `alive`. */
export type Liveness = "alive" | "dead" | "unknown";

/**
 * The one read this needs: the courses the portal offers this session.
 *
 * A `PortalReader` satisfies it, and so does a two-line object in a test. Narrower
 * than the full reader on purpose — the answer must not be reachable only through a
 * seam that also carries four methods nothing here calls.
 */
export type CourseReader = {
  courses: () => Promise<Option[]>;
};

/**
 * Ask the portal whether this session still works.
 *
 * The courses call is the cheapest thing that genuinely goes over the wire, and it
 * is the one call every account has an answer for.
 *
 * Never throws. A caller asking whether a session is alive should not have to catch
 * anything to find out, because "the check itself failed" is a different question
 * from "is the session gone" and both are answers this function owes.
 */
async function askPortal(
  portal: CourseReader
): Promise<{ verdict: Liveness; courses: Option[] }> {
  try {
    const courses = await portal.courses();
    // `realOptions` and not a length test: the placeholder is not a course, so a
    // reply containing only `-Select-` is an empty list wearing a 200.
    return {
      verdict: realOptions(courses).length ? "alive" : "dead",
      courses,
    };
  } catch (error) {
    // Only a 401 is proof. Everything else is `unknown` and must not evict.
    if (error instanceof HttpError && error.status === 401) {
      return { verdict: "dead", courses: [] };
    }
    return { verdict: "unknown", courses: [] };
  }
}

/**
 * The verdict on its own, for a caller that does not need the options.
 *
 * What `server.ts`'s probe wants: it is deciding whether to show a dashboard, not
 * what to put in a dropdown.
 */
export async function liveness(portal: CourseReader): Promise<Liveness> {
  const { verdict } = await askPortal(portal);
  return verdict;
}

/**
 * The verdict, plus the courses that produced it.
 *
 * **A caller that needs both must use this rather than reading the courses itself
 * and passing them in.** A caller that calls `portal.courses()` directly lets a
 * throw escape before the verdict is ever reached, so the 502-does-not-evict rule
 * holds by accident rather than by decision — and asking twice can also be
 * answered differently, which would mean judging a session on a different reply
 * than the one being displayed.
 *
 * That is not hypothetical: it is what the first version of `handleOptions` did,
 * and a mutation probe caught it.
 */
export function courseVerdict(
  portal: CourseReader
): Promise<{ verdict: Liveness; courses: Option[] }> {
  return askPortal(portal);
}
