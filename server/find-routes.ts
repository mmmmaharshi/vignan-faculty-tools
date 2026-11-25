/** One roll number in, the class ECAP says that student is in: the profile
 *  page it states, the class report over that class, and the panel the register
 *  would show for the same roll. */
import { ALL_SUBJECTS } from "../shared/api.js";
import type {
  FindReply,
  FindRequest,
  RegisterReply,
  Student,
} from "../shared/api.js";
import { sameRoll } from "../shared/portal-values.js";
import { readRegister } from "./class-routes.js";
import { endScan, scanStep, startScan } from "./find-scan.js";
import type { SectionScan } from "./find-scan.js";
import { HttpError, refusalOf, rethrowExpired } from "./http-error.js";
import type { PortalReader } from "./portal-reader.js";
import { parseStudentClass } from "./portal-student.js";
import { resolveClass } from "./student-class.js";
import {
  panelReads,
  profilePageOrThrow,
  readAbsences,
  readFullSemesterAbsences,
} from "./student-routes.js";

const PARTIAL_FIND = Symbol("partial-find");

/** A profile that arrived before attendance failed. The API spends its one
 *  revival on this error, then returns the carried reply if revival or retry
 *  also fails with anything except a 401. */
export class FindPartial extends HttpError {
  readonly [PARTIAL_FIND] = true;

  constructor(
    readonly reply: FindReply,
    cause: unknown
  ) {
    const refusal = refusalOf(cause);
    super(refusal.status, refusal.message);
    this.name = "FindPartial";
  }
}

export const isFindPartial = (error: unknown): error is FindPartial =>
  typeof error === "object" && error !== null && PARTIAL_FIND in error;

/**
 * One roll number in, the student's class and attendance figure out.
 *
 * The class comes from the student's own profile page — the one ECAP answer a
 * roll number is enough for — and the figure from the class attendance report
 * that page's class is read over. No picker, so a class the page states and the
 * Portal's lists do not agree on is a named answer rather than a guess.
 *
 * This is a deliberate ask from the Student Search tab, which is why it reads a
 * register at all; the refresh loop still never fetches one.
 */
export async function handleFind(
  portal: PortalReader,
  b: Partial<FindRequest>
): Promise<FindReply> {
  if (!b.from || !b.to) {
    throw new HttpError(400, "Choose a date range.");
  }
  const roll = b.roll?.trim();
  if (!roll) {
    throw new HttpError(400, "Enter a roll number.");
  }
  const html = await portal.studentProfile(roll);
  const profile = profilePageOrThrow(html);
  const statedClass = parseStudentClass(html);
  const profileOnly = (note: string, from: string, to: string): FindReply => ({
    profile,
    statedClass,
    class: null,
    window: { from, to },
    student: null,
    fullAbsent: null,
    fullRange: null,
    note,
  });
  let found: Awaited<ReturnType<typeof resolveClass>>;
  try {
    found = await resolveClass(portal, statedClass, profile);
  } catch (error) {
    rethrowExpired(error);
    const reason =
      error instanceof Error
        ? error.message
        : "ECAP's class lists could not be read.";
    throw new FindPartial(
      profileOnly(`Class could not be resolved: ${reason}`, b.from, b.to),
      error
    );
  }
  if (found.kind === "unstated") {
    return profileOnly(found.reason, b.from, b.to);
  }
  const resolved = found.value;
  // The class report states no dates, so its window is whatever we ask for.
  const window = { from: b.from, to: b.to };
  // The scan owns the four ways this loop can end. A found row stops it; an
  // answered report without the roll is the "No row" note, and only a scan where
  // no section answered owes an attendance warning beside the profile.
  let scan: SectionScan<Student> = startScan();
  for (const section of resolved.sections) {
    const gridRequest = {
      ...resolved.levels,
      section,
      subject: ALL_SUBJECTS,
      from: window.from,
      to: window.to,
    };
    let reply: RegisterReply | null = null;
    let failure: Error | null = null;
    try {
      // One roll's row is all this screen needs, so no subject's own report is
      // read for it: the columns it would fill are not shown here.
      reply = await readRegister(portal, gridRequest, window, {
        subjectPercents: false,
      });
    } catch (error) {
      // A dead session must still sign out. Anything else is one section this
      // search can do without: the next one may hold the roll.
      rethrowExpired(error);
      failure = error instanceof Error ? error : new Error(String(error));
    }
    scan = reply
      ? scanStep(scan, {
          kind: "answered",
          section,
          row: reply.students.find((row) => sameRoll(row.roll, roll)) ?? null,
        })
      : scanStep(scan, { kind: "refused", error: failure });
    if (scan.kind === "found" && reply) {
      const student = scan.row;
      // The class report states no dates, so the student's own grid is the only
      // place they exist — read them now, over the same window, the way the
      // panel does for a register row. The wider walk needs nothing from this
      // window's own read, so the two go out together, and either refusal ends
      // the session rather than leaving a promise to fail on its own.
      const [absences, full] = await Promise.all([
        readAbsences(portal, roll, {
          name: student.name,
          register: gridRequest,
        }),
        readFullSemesterAbsences(portal, roll, student.name, gridRequest),
      ]);
      // The semester's class counts, over the same start the absent walk found —
      // the window ECAP's Cumulative screen uses. The Search screen has no
      // register picker, so this is the only place its panel can get them. The
      // same panel reads the same month table here, so a search must not show
      // less than the register's panel does; neither needs anything of the
      // other, so they go out together too.
      const asked = {
        name: student.name,
        register: gridRequest,
        semStart: full.range?.from ?? window.from,
      };
      const reads = await panelReads(
        portal,
        roll,
        asked,
        Promise.resolve(absences)
      );
      if (reads.absent) {
        student.absent = reads.absent;
      }
      return {
        profile: { ...profile, ...reads },
        statedClass,
        class: {
          ...resolved.levels,
          section,
          semesterInferred: resolved.semesterInferred,
        },
        window: reply.summary.range,
        student,
        fullAbsent: full.absent,
        fullRange: full.range,
        note: full.note,
      };
    }
  }
  const ended = endScan(scan);
  if (ended.kind === "refused") {
    const reason =
      ended.error instanceof Error
        ? ended.error.message
        : "ECAP's class attendance report could not be read.";
    throw new FindPartial(
      {
        profile,
        statedClass,
        class: {
          ...resolved.levels,
          section: null,
          semesterInferred: resolved.semesterInferred,
        },
        window,
        student: null,
        fullAbsent: null,
        fullRange: null,
        note: `Attendance could not be read: ${reason}`,
      },
      ended.error
    );
  }
  const incomplete =
    scan.kind === "scanning" && scan.failure
      ? " Not every section could be read, so this no-row answer is incomplete."
      : "";
  return {
    profile,
    statedClass,
    class: {
      ...resolved.levels,
      section: null,
      semesterInferred: resolved.semesterInferred,
    },
    window,
    student: null,
    fullAbsent: null,
    fullRange: null,
    note: `No row for ${roll} in ${resolved.label} over ${window.from} to ${window.to}.${incomplete}`,
  };
}
