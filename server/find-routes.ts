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
import { HttpError, rethrowExpired } from "./http-error.js";
import type { PortalReader } from "./portal-reader.js";
import { parseStudentClass } from "./portal-student.js";
import { resolveClass } from "./student-class.js";
import {
  panelReads,
  profilePageOrThrow,
  readAbsences,
  readFullSemesterAbsences,
} from "./student-routes.js";

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
  const found = await resolveClass(portal, parseStudentClass(html), profile);
  if (found.kind === "unstated") {
    return {
      profile,
      class: null,
      window: { from: b.from, to: b.to },
      student: null,
      fullAbsent: null,
      fullRange: null,
      note: found.reason,
    };
  }
  const resolved = found.value;
  // The class report states no dates, so its window is whatever we ask for.
  const window = { from: b.from, to: b.to };
  // The scan owns the four ways this loop can end. Only a scan where no
  // section answered and at least one refused owes a portal failure; a report
  // that answered without the roll is the "No row" note instead.
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
    if (ended.error instanceof HttpError) {
      throw ended.error;
    }
    throw new HttpError(
      502,
      "ECAP's class attendance report came back in an unexpected shape, so no figure could be read for this student."
    );
  }
  return {
    profile,
    class: {
      ...resolved.levels,
      section: null,
      semesterInferred: resolved.semesterInferred,
    },
    window,
    student: null,
    fullAbsent: null,
    fullRange: null,
    note: `No row for ${roll} in ${resolved.label} over ${window.from} to ${window.to}.`,
  };
}
