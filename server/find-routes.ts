/** One roll number in, the class ECAP says that student is in: the profile
 *  page it states, the class report over that class, and the panel the register
 *  would show for the same roll. */
import { ALL_SUBJECTS } from "../shared/api.js";
import type { FindReply, FindRequest, RegisterReply } from "../shared/api.js";
import { sameRoll } from "../shared/portal-values.js";
import { readRegister } from "./class-routes.js";
import { HttpError, rethrowExpired, unreadablePage } from "./http-error.js";
import type { PortalReader } from "./portal-reader.js";
import { parseStudentClass, parseStudentProfile } from "./portal-student.js";
import { resolveClass } from "./student-class.js";
import {
  readAbsences,
  readFullSemesterAbsences,
  readMonths,
  readTotals,
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
  if (!b.from || !b.to) throw new HttpError(400, "Choose a date range.");
  const roll = b.roll?.trim();
  if (!roll) throw new HttpError(400, "Enter a roll number.");
  const html = await portal.studentProfile(roll);
  const profile = parseStudentProfile(html);
  if (!profile) {
    throw unreadablePage("student profile page");
  }
  const found = await resolveClass(portal, parseStudentClass(html), profile);
  if (typeof found === "string") {
    return {
      profile,
      class: null,
      window: { from: b.from, to: b.to },
      student: null,
      fullAbsent: null,
      fullRange: null,
      note: found,
    };
  }
  // The class report states no dates, so its window is whatever we ask for.
  const window = { from: b.from, to: b.to };
  // A report no section could give is a portal failure, not an absent student:
  // only a report that answered without the roll earns the "No row" note.
  let reportFailed: unknown = null;
  let reportAnswered = false;
  for (const section of found.sections) {
    const gridRequest = {
      ...found.levels,
      section,
      subject: ALL_SUBJECTS,
      from: window.from,
      to: window.to,
    };
    let reply: RegisterReply | null = null;
    try {
      reply = await readRegister(portal, gridRequest, window);
    } catch (error) {
      // A dead session must still sign out. Anything else is one section this
      // search can do without: the next one may hold the roll.
      rethrowExpired(error);
      reportFailed ??= error;
    }
    if (reply) reportAnswered = true;
    const student = reply?.students.find((row) => sameRoll(row.roll, roll));
    if (reply && student) {
      // The class report states no dates, so the student's own grid is the only
      // place they exist — read them now, over the same window, the way the
      // panel does for a register row. The wider walk needs nothing from this
      // window's own read, so the two go out together.
      const [absences, full] = await Promise.all([
        readAbsences(portal, roll, {
          name: student.name,
          register: gridRequest,
        }),
        readFullSemesterAbsences(portal, roll, student.name, gridRequest),
      ]);
      if (absences.absent) student.absent = absences.absent;
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
      const [totals, monthly] = await Promise.all([
        readTotals(portal, roll, asked),
        readMonths(portal, roll, asked),
      ]);
      return {
        profile: { ...profile, ...totals, ...monthly },
        class: {
          ...found.levels,
          section,
          semesterInferred: found.semesterInferred,
        },
        window: reply.summary.range,
        student,
        fullAbsent: full.absent,
        fullRange: full.range,
        note: full.note,
      };
    }
  }
  if (!reportAnswered && reportFailed) {
    if (reportFailed instanceof HttpError) throw reportFailed;
    throw new HttpError(
      502,
      "ECAP's class attendance report came back in an unexpected shape, so no figure could be read for this student."
    );
  }
  return {
    profile,
    class: {
      ...found.levels,
      section: null,
      semesterInferred: found.semesterInferred,
    },
    window,
    student: null,
    fullAbsent: null,
    fullRange: null,
    note: `No row for ${roll} in ${found.label} over ${window.from} to ${window.to}.`,
  };
}
