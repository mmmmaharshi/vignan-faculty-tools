/**
 * The two route handlers, as functions.
 *
 * They were inline in `Bun.serve({ fetch })`, which meant neither could be
 * tested: importing `server.ts` boots a server and binds the port. The handlers
 * are pure with respect to HTTP once the body is parsed and the session is
 * resolved - what is left is the ladder that decides which levels to ask the
 * portal for, and the checks that give a usable message.
 *
 * What stays in `server.ts` is genuinely HTTP: reading a cookie, parsing a body,
 * mapping an error to a status, and serving files. What moves here is the
 * decision-making, which is where the bugs were.
 *
 * Both take a `PortalReader` rather than a `Portal`, so a test can supply one
 * without a network. That is the second adapter - the live portal being the
 * first - and it is what makes the ladder below testable at all.
 *
 * See docs/adr/0008-route-to-named-handlers.md.
 */

import { summarise } from "./attendance-bands";
import { HttpError, level, parseRegister, realOptions } from "./portal-replies";
import type {
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
} from "./shared/api";

/** One position in the cascade. */
type Level = "course" | "semester" | "branch" | "section" | "subject";

/**
 * What a handler needs from the portal.
 *
 * The five reads and nothing else: no sign-in, no session, no transport. A
 * handler that could sign in would be doing the transport's job, and the point
 * of the split is that these are the parts worth testing.
 *
 * Property signatures, not methods, so an implementation may satisfy this with
 * an object literal - which is what a test's fake is.
 */
export type PortalReader = {
  courses: () => Promise<Option[]>;
  branchesAndSemesters: (courseId: string) => Promise<[Option[], Option[]]>;
  sections: (
    courseId: string,
    branchId: string,
    semester: string,
    semesterTitle?: string
  ) => Promise<Option[]>;
  subjects: (
    courseId: string,
    branchId: string,
    semesterId: string
  ) => Promise<Option[]>;
  register: (
    p: Record<Level, Option> & { from: string; to: string }
  ) => Promise<string>;
};

/* ------------------------------------------------------------------ /api/options */

/**
 * Every level that the chosen prefix makes derivable, and which came back empty.
 *
 * The whole selection arrives on every call; only the levels that are now
 * derivable get filled, and deeper ones come back empty so the front end can
 * disable them. Each level is conditional on the ones above it, so this cannot
 * be one literal - hence the accumulator rather than five independent calls.
 *
 * A level that *was* asked for and came back empty goes in `emptyLevels` rather
 * than throwing. Nothing observable has ever been empty, but the survey behind
 * that covers only the one course this account can see, and a 502 on an
 * unobserved course would block the screen for everyone. See `level` in
 * portal-replies.ts and ADR 0003.
 */
export async function handleOptions(
  portal: PortalReader,
  b: OptionsRequest
): Promise<OptionsReply> {
  const emptyLevels: Level[] = [];
  const out: OptionsReply = {
    course: [],
    semester: [],
    branch: [],
    section: [],
    subject: [],
    emptyLevels,
  };

  const take = (key: Level, list: Option[]): void => {
    const { choices, empty } = level(realOptions(list));
    out[key] = choices;
    if (empty) emptyLevels.push(key);
  };

  take("course", await portal.courses());

  if (b.course) {
    const [branches, semesters] = await portal.branchesAndSemesters(b.course);
    take("branch", branches);
    take("semester", semesters);
  }
  if (b.course && b.branch && b.semester) {
    take(
      "section",
      await portal.sections(b.course, b.branch, b.semester, b.semesterTitle)
    );
  }
  if (b.course && b.branch && b.semester && b.section) {
    take("subject", await portal.subjects(b.course, b.branch, b.semester));
  }
  return out;
}

/* ------------------------------------------------------------------ /api/register */

/**
 * The level the client named, checked for both halves.
 *
 * `ShowAcademicCalendar` needs every level by identifier *and* by visible text,
 * and returns nothing at all rather than failing when a label is missing. So
 * both are checked here, where the message can name the level that is wrong -
 * "Choose a branch first" rather than "choose a level first".
 */
export function chosenLevel(b: Partial<RegisterRequest>, key: Level): Option {
  const o = b[key];
  if (!o?.value || !o?.label) throw new HttpError(400, `Choose a ${key}.`);
  return o;
}

/** The whole selection, each level whole, validated one at a time. */
export function requireLevels(
  b: Partial<RegisterRequest>
): Record<Level, Option> {
  return {
    course: chosenLevel(b, "course"),
    semester: chosenLevel(b, "semester"),
    branch: chosenLevel(b, "branch"),
    section: chosenLevel(b, "section"),
    subject: chosenLevel(b, "subject"),
  };
}

/**
 * The register for one subject over one date range, with its bands and summary.
 *
 * The empty case names both causes deliberately. "The subject has no classes in
 * that date range" is the common one and the one the user can act on; "ECAP's
 * page layout has changed" is the one that means this app is broken. Saying
 * only the first sends a reader to change dates that would never have worked.
 */
export async function handleRegister(
  portal: PortalReader,
  b: Partial<RegisterRequest>
): Promise<RegisterReply> {
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");

  // Every level arrives whole, because the client is the only side that still
  // holds the labels. Checked per level, so the message names the wrong one.
  const p = requireLevels(b);
  const { from, to } = b;

  const rows = parseRegister(await portal.register({ ...p, from, to }));
  if (!rows.length) {
    throw new HttpError(
      502,
      "The register came back empty. Either the subject has no classes in that date range, or ECAP's page layout has changed."
    );
  }

  // The bands and the counts come from one module and one pass, so the stat
  // cards cannot disagree with the flags on the rows. See attendance-bands.ts.
  return summarise(rows, { from, to });
}
