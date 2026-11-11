/** The cascade's options, the register itself, and the semester start: every
 *  read that comes back from the Academic Register page, whichever of its modes
 *  the selection names. */
import { ALL_SUBJECTS, isAllSubjects } from "../shared/api.js";
import type {
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  SemStartReply,
  SemStartRequest,
} from "../shared/api.js";
import { statedStartDate, matchOption } from "../shared/portal-values.js";
import type { OverallLookup } from "./attendance-bands.js";
import { summarise } from "./attendance-bands.js";
import { HttpError, rethrowExpired } from "./http-error.js";
import {
  MONTH_WALK_CAP,
  monthStart,
  monthWindow,
  previousMonth,
} from "./month-windows.js";
import { requireCourses } from "./portal-liveness.js";
import { realOptions } from "./portal-options.js";
import type { Level, PortalReader } from "./portal-reader.js";
import {
  classReportSubjects,
  parseClassAttendance,
  parseRegister,
  parseSubjectReport,
  registerDates,
} from "./portal-register.js";
import type { OverallRow } from "./portal-register.js";
import { requireLevels } from "./register-levels.js";

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
    const choices = realOptions(list);
    out[key] = choices;
    if (!choices.length) emptyLevels.push(key);
  };
  // A list held from an earlier pass of the same run is the Portal's own
  // answer under these same parents, so it is used as stated instead of
  // asked for again. An empty held list states nothing and is refetched.
  const held = (key: Level): Option[] | null => {
    const list = b.held?.[key];
    return list?.length ? list : null;
  };
  // Whether ECAP was asked anything this call. A request holding every list
  // still proves the session the way any other call does: a dead session
  // refuses even with nothing left to fetch.
  let fetched = false;
  /** A held list reused as stated, or the Portal asked once. Marks which. */
  const reuse = (
    list: Option[] | null,
    fetch: () => Promise<Option[]>
  ): Promise<Option[]> => {
    if (list) return Promise.resolve(list);
    fetched = true;
    return fetch();
  };
  take("course", await reuse(held("course"), () => requireCourses(portal)));
  if (b.course) {
    // Branches and semesters arrive in one reply, so one held list cannot
    // stand in for the pair: both travel or the Portal is asked.
    const heldBranch = held("branch");
    const heldSemester = held("semester");
    let branches: Option[];
    let semesters: Option[];
    if (heldBranch && heldSemester) {
      [branches, semesters] = [heldBranch, heldSemester];
    } else {
      fetched = true;
      [branches, semesters] = await portal.branchesAndSemesters(b.course);
    }
    take("branch", branches);
    take("semester", semesters);
  }
  if (b.course && b.branch && b.semester) {
    // The batch number travels beside the semester value, and only the Portal's
    // own list states it. It is resolved here from the list just fetched, with
    // the client's value only as a fallback: a client whose cascade has not
    // settled yet sends none, and an unresolved batch asks the wrong section
    // list.
    const batch =
      out.semester.find((o) => String(o.value) === String(b.semester))?.title ||
      b.semesterTitle;
    const { course } = b;
    const { branch } = b;
    const { semester } = b;
    take(
      "section",
      await reuse(held("section"), () =>
        portal.sections(course, branch, semester, batch)
      )
    );
  }
  if (b.course && b.branch && b.semester && b.section) {
    // A held subject list already leads with ALL SUBJECTS — it is a past
    // reply, and every reply does. The lead entry is added again below, so
    // the held one is set aside first: reusing a reply must read the same.
    const heldSubject = held("subject")?.filter(
      (o) => o.value !== ALL_SUBJECTS.value
    );
    const subjectCourse = b.course;
    const subjectBranch = b.branch;
    const subjectSemester = b.semester;
    take(
      "subject",
      await reuse(heldSubject?.length ? heldSubject : null, () =>
        portal.subjects(subjectCourse, subjectBranch, subjectSemester)
      )
    );
    // First, so the whole section is one click away, and upper-cased so it reads
    // as a mode rather than as one of the portal's short codes. An empty level
    // must stay empty, or the cascade would think it had nothing left to fetch.
    if (out.subject.length) out.subject = [ALL_SUBJECTS, ...out.subject];
  }
  if (!fetched) {
    // Every list travelled, so ECAP was asked nothing — but the call still
    // proves the session the way any other call does. A dead session refuses
    // even here, instead of answering 200 on a session that is gone.
    await requireCourses(portal);
  }
  return out;
}
/**
 * The class-wide report is a second Portal screen. If it fails, or its layout
 * has moved, the register that already worked must still render, so nothing here
 * is allowed to throw on the subject path. See
 * .scratch/overall-attendance/issues/01.
 */
async function readOverall(
  portal: PortalReader,
  p: Record<Level, Option> & { from: string; to: string }
): Promise<{ rows: OverallRow[]; byRoll: OverallLookup; subjects: string[] }> {
  try {
    const reply = await portal.classAttendance(p);
    const rows = parseClassAttendance(reply);
    return {
      rows,
      byRoll: new Map(
        rows.map((row) => [
          row.roll,
          { attendedOfHeld: row.attendedOfHeld, pct: row.pct },
        ])
      ),
      subjects: classReportSubjects(reply),
    };
  } catch (error) {
    rethrowExpired(error);
    return { rows: [], byRoll: new Map(), subjects: [] };
  }
}
/**
 * The subject list the SUBJECT ATTENDANCE page offers for one class, or null
 * where ECAP will not give it. Null is not an empty class: the caller still
 * names the columns the class report states, and every cell stays a dash.
 */
async function listOfferedSubjects(
  portal: PortalReader,
  p: Record<Level, Option>
): Promise<Option[] | null> {
  try {
    return realOptions(
      await portal.subjectOptions(
        p.course.value,
        p.branch.value,
        p.semester.value
      )
    );
  } catch (error) {
    rethrowExpired(error);
    return null;
  }
}
/**
 * One subject's stated percentages, keyed by roll: the All subjects view
 * names its columns from the class report, but the figures come from each
 * subject's own report, read in parallel. A column whose subject the
 * Portal's own subject list does not offer is dropped rather than guessed;
 * a subject ECAP will not answer leaves dashes rather than failing the
 * register; a dead session still signs out.
 */
async function readSubjectPercents(
  portal: PortalReader,
  p: Record<Level, Option> & { from: string; to: string },
  columns: string[],
  offered: Option[] | null
): Promise<{
  labels: string[];
  byColumn: Map<string, Map<string, number | null>>;
}> {
  if (offered === null) {
    // The listing itself failed: name the columns the class report states,
    // with no figures rather than no columns — the same dash a failed
    // subject report earns.
    return { labels: columns, byColumn: new Map() };
  }
  const pairs = columns
    .map((label) => ({ label, subject: matchOption(label, offered) }))
    .filter(
      (pair): pair is { label: string; subject: Option } =>
        pair.subject !== null
    );
  const byColumn = new Map<string, Map<string, number | null>>();
  await Promise.all(
    pairs.map(async ({ label, subject }) => {
      try {
        const grid = parseSubjectReport(await portal.subjectReport(p, subject));
        byColumn.set(
          label,
          new Map(grid.map((row) => [row.roll, row.pct] as const))
        );
      } catch (error) {
        rethrowExpired(error);
      }
    })
  );
  return { labels: pairs.map((pair) => pair.label), byColumn };
}
/**
 * The register one settled selection and window answer. No request validation:
 * the five levels and the dates arrive resolved, because the callers that build
 * a request themselves (the search) already hold them. Throws the named 502
 * where the reply states no rows, so a caller that can live without one catches.
 */
export async function readRegister(
  portal: PortalReader,
  p: Record<Level, Option>,
  window: { from: string; to: string },
  /** Whether to read each subject's own report for its column figures. The
   *  search needs one roll's row and nothing else, and every column is one
   *  ECAP read — asked, on the All subjects path, for figures nobody reads. */
  { subjectPercents = true }: { subjectPercents?: boolean } = {}
): Promise<RegisterReply> {
  const { from, to } = window;
  if (isAllSubjects(p.subject)) {
    // No subject was chosen, so the class report is the whole register and its
    // emptiness is a real failure rather than a report to render without.
    // The report and the subject listing need nothing from each other, so
    // they go out together; the per-subject reads wait for both.
    const [{ rows, byRoll, subjects: columns }, offered] = await Promise.all([
      readOverall(portal, { ...p, from, to }),
      // Skipped rather than read and dropped: `readSubjectPercents` names the
      // report's own columns with a dash each, which is the answer a caller that
      // wants no figures already gets.
      subjectPercents ? listOfferedSubjects(portal, p) : Promise.resolve(null),
    ]);
    if (!rows.length) {
      throw new HttpError(
        502,
        "The class attendance report came back empty. Either the section has no classes in that date range, or ECAP's page layout has changed."
      );
    }
    // Each column's percentages come from that subject's own report, read in
    // parallel: the class report states counts, never percentages.
    const { labels: subjectColumns, byColumn: pctByColumn } =
      await readSubjectPercents(portal, { ...p, from, to }, columns, offered);
    return summarise(
      rows.map((row) => ({
        sl: row.sl,
        roll: row.roll,
        name: row.name,
        attendedOfHeld: "",
        pct: null,
        subjects: subjectColumns.map(
          (column) => pctByColumn.get(column)?.get(row.roll) ?? null
        ),
        absent: [],
      })),
      window,
      byRoll,
      null,
      null,
      [],
      subjectColumns
    );
  }
  // The grid and the class-wide report need nothing from each other, so
  // both go out together. An empty register still fails as an empty
  // register even when the class report fails beside it, so the two answers
  // are settled separately and read in the old order. A dead session still
  // surfaces as a 401 either way.
  const [registerSettled, overallSettled] = await Promise.allSettled([
    portal.register({ ...p, from, to }),
    readOverall(portal, { ...p, from, to }),
  ]);
  if (registerSettled.status === "rejected") throw registerSettled.reason;
  const rows = parseRegister(registerSettled.value);
  if (!rows.length) {
    throw new HttpError(
      502,
      "The register came back empty. Either the subject has no classes in that date range, or ECAP's page layout has changed."
    );
  }
  if (overallSettled.status === "rejected") throw overallSettled.reason;
  const { byRoll } = overallSettled.value;
  // The grid's own date columns are the working-days count: a grid that
  // states none leaves the summary bare rather than printing a zero. The
  // first one is where the figures begin, so the input can snap to it.
  const dates = registerDates(registerSettled.value);
  return summarise(
    rows,
    window,
    byRoll,
    dates.length || null,
    statedStartDate(dates, window),
    dates
  );
}
export async function handleRegister(
  portal: PortalReader,
  b: Partial<RegisterRequest>
): Promise<RegisterReply> {
  // Async so a refused request rejects rather than throwing at the call site:
  // the route table calls this and awaits it.
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");
  return await readRegister(portal, requireLevels(b), {
    from: b.from,
    to: b.to,
  });
}
/**
 * The semester's first held day, walking back month by month from the asked
 * `to`: the asked month plus up to `steps` before it, each a month-shaped
 * read — the only shape ECAP reliably answers, wide registers come back
 * empty. The first month stating no meeting days stops the walk, and the
 * earliest month stating any names the start. A whole break month with no
 * meetings stops the walk early; accepted, the same trade the semester
 * absences walk makes.
 */
async function walkSemStart(
  portal: PortalReader,
  p: Record<Level, Option>,
  to: string,
  steps: number
): Promise<SemStartReply> {
  const [, tm, ty] = to.split("/").map(Number);
  if (!tm || !ty || tm > 12) throw new HttpError(400, "Choose a date range.");
  let start: string | null = null;
  let year = ty;
  let month = tm;
  for (let step = 0; step <= steps; step++) {
    const window = monthWindow(year, month);
    const startOfMonth = monthStart(
      registerDates(await portal.register({ ...p, ...window })),
      year,
      month
    );
    if (!startOfMonth) break;
    start = startOfMonth;
    ({ year, month } = previousMonth(year, month));
  }
  return { statedFrom: start };
}
/**
 * One subject's earliest held day inside the asked window, for the All subjects
 * path whose own report states no dates at all. Reads that subject's register
 * grid and returns only its first date — never a roster — so the All subjects
 * view can name a start date without fetching a second register. Null where
 * the grid states no dates, which is not a clean sheet; a 401 still propagates
 * so a dead session signs out.
 *
 * With `walkBack` the read walks back instead: the asked month plus up to
 * that many before it, for the settle-time probe that opens From at the
 * semester rather than the month.
 */
export async function handleSemStart(
  portal: PortalReader,
  b: Partial<SemStartRequest>
): Promise<SemStartReply> {
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");
  const p = requireLevels(b);
  const steps = Math.min(
    Math.max(Math.floor(b.walkBack ?? 0), 0),
    MONTH_WALK_CAP
  );
  if (!steps) {
    const dates = registerDates(
      await portal.register({ ...p, from: b.from, to: b.to })
    );
    if (!dates.length) return { statedFrom: null };
    return { statedFrom: statedStartDate(dates, { from: b.from, to: b.to }) };
  }
  return walkSemStart(portal, p, b.to, steps);
}
