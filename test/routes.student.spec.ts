import { expect, test } from "@playwright/test";

import { handleFind } from "../server/find-routes";
import { HttpError } from "../server/http-error";
import type { PortalReader } from "../server/portal-reader";
import {
  handleSemAbsences,
  handleStudentProfile,
} from "../server/student-routes";
import { ALL_SUBJECTS } from "../shared/api";
import { todayIST } from "../shared/portal-values";
import {
  CLASS_PAGE,
  CLASS_PAGE_NO_SEM,
  CLASS_PAGE_NO_SGPA,
  ask,
  bothStarted,
  classGrid,
  fake,
  levels,
  monthGrid,
  nth,
  opt,
  semAbsencesAsked,
  startedPair,
} from "./support/routes-fake";

/** A dd/mm/yyyy date as one comparable month number, for "the next month". */
const monthIndex = (date: string): number => {
  const [, m, y] = date.split("/").map(Number);
  return (y ?? 0) * 12 + (m ?? 0);
};

test.describe("the student profile handler", () => {
  test("one student's GPA and numbers, read by roll number", async () => {
    const { reader, calls } = fake();
    const reply = await handleStudentProfile(reader, { roll: "21CS001" });
    expect(calls.studentProfile).toEqual(["21CS001"]);
    expect(reply.cgpa).toBe("5.61");
    expect(reply.credits).toBe("16/19");
    expect(reply.cgpaPercent).toBe("48.55");
    expect(reply.phones).toEqual([
      { label: "Mobile.No", number: "7661864881" },
    ]);
  });
  test("no roll number is refused before the portal is asked", async () => {
    const { reader, calls } = fake();
    await expect(handleStudentProfile(reader, { roll: "  " })).rejects.toThrow(
      "Choose a student."
    );
    expect(calls.studentProfile).toEqual([]);
  });
  test("a reply that is not the profile page is a 502, not an empty panel", async () => {
    const { reader } = fake({ studentProfile: "<p>nothing here</p>" });
    const failure = await handleStudentProfile(reader, {
      roll: "21CS001",
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(502);
  });
  test("a student whose profile states nothing is a reply, not a failure", async () => {
    const { reader } = fake({
      studentProfile: "<div id='divProfile_BioData'><table></table></div>",
    });
    const reply = await handleStudentProfile(reader, { roll: "21CS001" });
    expect(reply).toEqual({
      cgpa: "",
      credits: "",
      cgpaPercent: "",
      sgpa: [],
      phones: [],
      backlogs: { rows: [], total: null, note: "" },
    });
  });
  test("the semester's totals are asked from the start to today, and only when the start is known", async () => {
    const { reader, calls } = fake();
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      name: "A Student",
      register: levels(),
      semStart: "05/08/2026",
    });
    expect(reply.totals).toEqual({ held: 21, attend: 21, absent: 0 });
    expect(calls.studentCumulative, "one read, over start to today").toEqual([
      ["21CS001", "A Student", "05/08/2026", todayIST()],
    ]);

    // No start: nothing is asked, because a guessed window would count a
    // period nobody chose.
    const second = fake();
    const noStart = await handleStudentProfile(second.reader, {
      roll: "21CS001",
      register: levels(),
    });
    expect(noStart.totals).toBeUndefined();
    expect(second.calls.studentCumulative).toEqual([]);
  });
  test("a dead session stays a 401, so the client signs out", async () => {
    const { reader } = fake();
    const dead: PortalReader = {
      ...reader,
      studentProfile: () => Promise.reject(new HttpError(401, "expired")),
    };
    const failure = await handleStudentProfile(dead, { roll: "21CS001" }).catch(
      (error: unknown) => error
    );
    expect((failure as HttpError).status).toBe(401);
  });
  test("cumulative attendance is read month by month, from the semester start", async () => {
    // Three months back, so the row count follows from the spec's "from the
    // start's month to now" rather than from whatever the handler built.
    const [todayDay, todayMonth, todayYear] = todayIST().split("/").map(Number);
    const startYear = (todayMonth ?? 1) > 3 ? todayYear : (todayYear ?? 1) - 1;
    const startMonth =
      (todayMonth ?? 1) > 3 ? (todayMonth ?? 1) - 3 : (todayMonth ?? 1) + 9;
    const semStart = `05/${String(startMonth).padStart(2, "0")}/${startYear}`;
    // The month in progress answers with a stated figure, so the row that is
    // always present carries the one ECAP stated.
    const { reader, calls } = fake({
      classAttendanceMonths: {
        [todayIST()]: classGrid([["21CS001", "30\\40", "75"]]),
      },
    });
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      name: "A Student",
      register: levels(),
      semStart,
    });
    const months = reply.months ?? [];
    expect(
      months.length,
      "the start's month through this one, both counted"
    ).toBe(4);
    // The dates label each month in turn, so the column reads as a sequence:
    // the term's first month opens where the semester did, and every later one
    // on its own first day. The percentage stays cumulative — that is what
    // every call asks ECAP for, checked below.
    expect(
      months[0]?.month.from,
      "the first month opens at the semester start"
    ).toBe(semStart);
    expect(
      months.slice(1).every((month) => month.month.from.startsWith("01/")),
      "every later month opens on its first day"
    ).toBe(true);
    // Each row ends on its own month's last day, except the one still running.
    for (const [index, month] of months.entries()) {
      const [day, monthNumber, year] = month.month.to.split("/").map(Number);
      const last = index === months.length - 1;
      expect(day, `${month.month.to} ends where it should`).toBe(
        last ? todayDay : new Date(year ?? 0, monthNumber ?? 0, 0).getDate()
      );
      const previous = months[index - 1];
      if (!previous) continue;
      expect(
        monthIndex(month.month.to) - monthIndex(previous.month.to),
        `${month.month.to} follows ${previous.month.to}`
      ).toBe(1);
      expect(
        monthIndex(month.month.from) - monthIndex(previous.month.to),
        `${month.month.from} continues where ${previous.month.to} stopped`
      ).toBe(1);
    }
    const current = months.at(-1);
    expect(current?.month.to, "the month in progress ends today").toBe(
      todayIST()
    );
    expect(
      current?.pct,
      "ECAP's own figure for that window, not one we divided"
    ).toBe(75);
    expect(
      calls.classAttendance.every((call) => call.from === semStart),
      "every call asks from the semester start"
    ).toBe(true);
  });
  test("a start older than the cap keeps the newest months, not the oldest", async () => {
    const { reader } = fake();
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      register: levels(),
      // Two years before the month in progress: longer than the cap, so the
      // table must still reach today rather than stopping a year short.
      semStart: "05/01/2025",
    });
    const months = reply.months ?? [];
    expect(months.length, "capped at twelve").toBe(12);
    expect(
      months.at(-1)?.month.to,
      "and the newest row is the month in progress"
    ).toBe(todayIST());
    expect(
      months.every((month) => month.month.from.startsWith("01/")),
      "a capped table starts on a month boundary, not on the stale start day"
    ).toBe(true);
  });
  test("a month ECAP refuses reads blank, and the rest of the table stands", async () => {
    const semStart = "05/08/2026";
    const { reader } = fake({ classFailsMonths: ["30/09/2026"] });
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      register: levels(),
      semStart,
    });
    const months = reply.months ?? [];
    expect(months.length, "the table is still a finding").toBeGreaterThan(1);
    const september = months.find((month) => month.month.to === "30/09/2026");
    expect(september?.pct, "no figure is not a failing figure").toBeNull();
    expect(
      months.filter((month) => month.pct != null).length,
      "the months ECAP did answer keep their figures"
    ).toBe(months.length - 1);
  });
  test("a month that refuses the session still signs out", async () => {
    const { reader } = fake({ classDeadMonths: ["30/09/2026"] });
    const failure = await handleStudentProfile(reader, {
      roll: "21CS001",
      register: levels(),
      semStart: "05/08/2026",
    }).catch((error: unknown) => error);
    expect((failure as HttpError).status).toBe(401);
  });
  test("no semester start means no month table, and no class report asked", async () => {
    const { reader, calls } = fake();
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      register: levels(),
    });
    expect(reply.months).toBeUndefined();
    expect(calls.classAttendance).toEqual([]);
  });
  test("a totals read ECAP refuses leaves the panel's other answers alone", async () => {
    const { reader } = fake({ studentFails: true });
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      register: levels(),
      semStart: "05/08/2026",
    });
    expect(reply.totals).toBeUndefined();
    expect(reply.cgpa, "the profile still answers").toBe("5.61");
  });
  test("the All subjects register gets the student's own absent dates, once", async () => {
    const { reader, calls } = fake();
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      name: "A Student",
      register: levels({ subject: ALL_SUBJECTS }),
    });
    expect(
      calls.studentWise,
      "one call, over that register's own range"
    ).toEqual([["21CS001", "A Student"]]);
    expect(reply.absent, "the union, in the grid's own date order").toEqual([
      "05/08",
      "06/08",
    ]);
    expect(reply.cgpa).toBe("5.61");
  });
  test("a subject register asks for no second call: its own rows state the dates", async () => {
    const { reader, calls } = fake();
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      register: levels(),
    });
    expect(calls.studentWise).toEqual([]);
    expect(reply.absent).toBeUndefined();
  });
  test("a report ECAP will not give leaves the panel, not the student", async () => {
    const { reader } = fake({ studentFails: true });
    const reply = await handleStudentProfile(reader, {
      roll: "21CS001",
      register: levels({ subject: ALL_SUBJECTS }),
    });
    expect(reply.cgpa, "the panel's own read still lands").toBe("5.61");
    expect(
      reply.absent,
      "stated as nothing rather than as no absences"
    ).toBeUndefined();
  });
  test("a dead session on the absent dates is still a 401", async () => {
    const { reader } = fake();
    const dead: PortalReader = {
      ...reader,
      studentWise: () => Promise.reject(new HttpError(401, "expired")),
    };
    const failure = await handleStudentProfile(dead, {
      roll: "21CS001",
      register: levels({ subject: ALL_SUBJECTS }),
    }).catch((error: unknown) => error);
    expect((failure as HttpError).status).toBe(401);
  });
});

test.describe("the full-semester absences read", () => {
  const GRID = `<table>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Name</th><th>05/08</th><th>06/08</th><th>Attend/Held</th><th>%</th></tr>
    <tr><td>1</td><td>21CS001</td><td>A</td><td>P</td><td>A</td><td>1/2</td><td>50</td></tr>
    <tr><td>2</td><td>21CS002</td><td>B</td><td>A</td><td>P</td><td>1/2</td><td>50</td></tr>
  </table>`;
  test("a subject path reads that student's row over the wider window", async () => {
    const { reader, calls } = fake({ register: GRID });
    const reply = await handleSemAbsences(reader, semAbsencesAsked());
    expect(
      calls.register.map((c) => [c.from, c.to]),
      "the same register read, over the remembered start"
    ).toEqual([["05/08/2026", "28/09/2026"]]);
    expect(reply).toEqual({ absent: ["06/08"] });
  });
  test("a student the wider grid never mentions is stated as nothing", async () => {
    const { reader } = fake({ register: GRID });
    const reply = await handleSemAbsences(reader, semAbsencesAsked("21CS999"));
    expect(reply, "not a clean sheet").toEqual({});
  });
  test("the All subjects path reads that student's own grid instead", async () => {
    const { reader, calls } = fake();
    const reply = await handleSemAbsences(
      reader,
      semAbsencesAsked("21CS001", { subject: ALL_SUBJECTS })
    );
    expect(calls.register, "no roster read on this path").toHaveLength(0);
    expect(calls.studentWise).toEqual([["21CS001", "A"]]);
    expect(reply).toEqual({ absent: ["05/08", "06/08"] });
  });
  test("a grid that states no dates states nothing, not a clean sheet", async () => {
    const { reader } = fake({ studentWise: "<p>not that report</p>" });
    const reply = await handleSemAbsences(
      reader,
      semAbsencesAsked("21CS001", { subject: ALL_SUBJECTS })
    );
    expect(reply.absent, "absent, not an empty list").toBeUndefined();
  });
  test("no student, no register or no start is refused before the portal is asked", async () => {
    const { reader, calls } = fake({ register: GRID });
    await expect(
      handleSemAbsences(reader, { register: levels(), from: "05/08/2026" })
    ).rejects.toThrow("Choose a student.");
    await expect(
      handleSemAbsences(reader, { roll: "21CS001", from: "05/08/2026" })
    ).rejects.toThrow("Open a register first.");
    await expect(
      handleSemAbsences(reader, { roll: "21CS001", register: levels() })
    ).rejects.toThrow("Choose a date range.");
    expect(calls.register).toHaveLength(0);
    expect(calls.studentWise).toHaveLength(0);
  });
  test("a dead session stays a 401, so the client signs out", async () => {
    const { reader } = fake();
    const dead: PortalReader = {
      ...reader,
      register: () => Promise.reject(new HttpError(401, "expired")),
    };
    const failure = await handleSemAbsences(dead, semAbsencesAsked()).catch(
      (error: unknown) => error
    );
    expect((failure as HttpError).status).toBe(401);
  });
});

test.describe("a roll number searched on its own", () => {
  test("find reads no subject register, only the class report", async () => {
    const { reader, calls } = fake({ studentProfile: CLASS_PAGE });
    await handleFind(reader, { roll: "21CS001", ...ask });
    // The semester start comes off the section's own grid, month by month —
    // never a subject register over a wide range, which ECAP answers empty.
    expect(calls.register).toEqual([]);
  });
  test("a Search result states the semester's class counts beside the profile", async () => {
    const { reader, calls } = fake({
      studentProfile: CLASS_PAGE,
      studentWiseMonths: {
        "01/10/2025": monthGrid("01/10"),
        "01/09/2025": monthGrid("15/09"),
      },
    });
    const reply = await handleFind(reader, { roll: "21CS001", ...ask });
    expect(reply.profile.totals, "counted from the same grid").toEqual({
      held: 21,
      attend: 21,
      absent: 0,
    });
    // Asked from the semester start the walk settled on, not the month asked
    // for: the totals are a semester figure.
    expect(calls.studentCumulative.map((call) => call[2])).toEqual([
      reply.fullRange?.from,
    ]);
  });
  test("the window's absent grid and the semester's walk go out together", async () => {
    const { reader } = fake({ studentProfile: CLASS_PAGE });
    // The page is read first, so only the Student Wise reads are held. Two in
    // flight at once is what says the window's own list and the walk were not
    // asked one after the other.
    const { started, loaded, release } = startedPair(
      reader,
      (held) => handleFind(held, { roll: "21CS001", ...ask }),
      ["wise"]
    );
    await expect.poll(() => started.length).toBe(2);
    bothStarted(started, "wise", "wise");
    release();
    await loaded;
  });
  test("the full-semester list walks back month by month to the first held day", async () => {
    const { reader, calls } = fake({
      studentProfile: CLASS_PAGE,
      studentWise: "",
      studentWiseMonths: {
        "01/10/2025": monthGrid("01/10"),
        "01/09/2025": monthGrid("15/09"),
      },
    });
    const reply = await handleFind(reader, { roll: "21CS001", ...ask });
    // August answers empty, so the walk stops: the start is September's day.
    expect(reply.fullRange).toEqual({
      from: "15/09/2025",
      to: "22/10/2025",
    });
    expect(reply.fullAbsent).toEqual(["15/09", "01/10"]);
    // One read per month stepped, newest first, stopping at dateless August —
    // plus the asked month's own read that the window list came from.
    expect(calls.studentWiseWindows.map((w) => w.from)).toEqual([
      "01/10/2025",
      "01/10/2025",
      "01/09/2025",
      "01/08/2025",
    ]);
    // The asked month's own list is exactly that month, beside the walk.
    expect(reply.student?.absent).toEqual(["01/10"]);
    expect(reply.window.from).toBe(ask.from);
  });
  test("a month the portal will not give ends the walk with a warning", async () => {
    const { reader: base } = fake({
      studentProfile: CLASS_PAGE,
      studentWiseMonths: { "01/10/2025": monthGrid("01/10") },
    });
    const reader: PortalReader = {
      ...base,
      studentWise: (roll, name, p) =>
        p.from === "01/09/2025"
          ? Promise.reject(new HttpError(502, "month unavailable"))
          : base.studentWise(roll, name, p),
    };
    const reply = await handleFind(reader, { roll: "21CS001", ...ask });
    // October's day is kept, but the list must never pass for complete.
    expect(reply.fullAbsent).toEqual(["01/10"]);
    expect(reply.fullRange).toEqual({
      from: "01/10/2025",
      to: "22/10/2025",
    });
    expect(reply.note).toContain("incomplete");
    // The profile, figure and month list still answer.
    expect(reply.student?.overallPct).toBe(79.21);
  });
  test("a dead session during the walk still signs out", async () => {
    const { reader: base } = fake({ studentProfile: CLASS_PAGE });
    const reader: PortalReader = {
      ...base,
      studentWise: () => Promise.reject(new HttpError(401, "expired")),
    };
    const failure = await handleFind(reader, {
      roll: "21CS001",
      ...ask,
    }).catch((error: unknown) => error);
    expect((failure as HttpError).status).toBe(401);
  });
  test("a walk that never finds a dateless month says the start may be earlier", async () => {
    // Twelve months of meeting days: the cap, not a found start, ends it.
    const months: Record<string, string> = {};
    for (let back = 0; back < 12; back++) {
      const at = new Date(2025, 9 - back, 1);
      const key = `01/${String(at.getMonth() + 1).padStart(2, "0")}/${at.getFullYear()}`;
      months[key] = monthGrid(
        `15/${String(at.getMonth() + 1).padStart(2, "0")}`
      );
    }
    const { reader } = fake({
      studentProfile: CLASS_PAGE,
      studentWise: "",
      studentWiseMonths: months,
    });
    const reply = await handleFind(reader, { roll: "21CS001", ...ask });
    expect(reply.fullRange?.from).toBe("15/11/2024");
    expect(reply.note).toContain("earlier than shown");
  });
  test("a class report no section could give fails instead of reading absent", async () => {
    const { reader } = fake({
      studentProfile: CLASS_PAGE,
      classFails: true,
    });
    const failure = await handleFind(reader, {
      roll: "21CS001",
      ...ask,
    }).catch((error: unknown) => error);
    expect((failure as HttpError).status).toBe(502);
    expect((failure as HttpError).message).toMatch(/class attendance report/);
  });
  test("is read through the class the student's own page states", async () => {
    const { reader, calls } = fake({ studentProfile: CLASS_PAGE });
    const reply = await handleFind(reader, { roll: "21CS001", ...ask });
    expect(reply.class?.branch.label).toBe("IT");
    expect(reply.class?.section?.label).toBe("Section-1");
    // The page stated this semester, so the panel prints it as a fact.
    expect(reply.class?.semesterInferred).toBe(false);
    // The figure is the class report's own row, read over the asked window.
    expect(reply.student?.overallPct).toBe(79.21);
    expect(reply.student?.absent).toEqual(["05/08", "06/08"]);
    expect(reply.profile.phones).toHaveLength(1);
    const report = nth(calls.classAttendance, 0);
    expect(report.subject).toEqual(ALL_SUBJECTS);
    expect(report.from).toBe(ask.from);
  });
  test("a page that does not state a branch is a named answer, not a guess", async () => {
    const { reader, calls } = fake({
      studentProfile: CLASS_PAGE.replace(
        "<tr><td>Branch</td><td>:</td><td>IT</td></tr>",
        ""
      ),
    });
    const reply = await handleFind(reader, { roll: "21CS001", ...ask });
    expect(reply.class).toBeNull();
    expect(reply.student).toBeNull();
    expect(reply.note).toContain("branch");
    // Nothing is read for a class that could not be named.
    expect(calls.classAttendance).toEqual([]);
    // The profile is still the answer the page gives.
    expect(reply.profile.cgpa).toBe("5.61");
  });
  test("a roll in none of the sections keeps its profile and says so", async () => {
    const { reader } = fake({ studentProfile: CLASS_PAGE });
    const reply = await handleFind(reader, { roll: "99ZZ999", ...ask });
    expect(reply.student).toBeNull();
    expect(reply.class?.section).toBeNull();
    expect(reply.note).toContain("99ZZ999");
    expect(reply.profile.cgpa).toBe("5.61");
  });
});

test.describe("a roll whose page names no semester", () => {
  test("is read through the semester inferred from its SGPAs", async () => {
    const { reader, calls } = fake({
      studentProfile: CLASS_PAGE_NO_SEM,
      semester: [opt("2", "II Semester"), opt("3", "III Semester")],
    });
    const reply = await handleFind(reader, {
      roll: "21CS001",
      from: "01/10/2025",
      to: "22/10/2025",
    });
    expect(reply.class?.semester.label).toBe("III Semester");
    expect(reply.class?.semesterInferred).toBe(true);
    expect(reply.class?.section?.label).toBe("Section-1");
    expect(reply.student?.overallPct).toBe(79.21);
    expect(nth(calls.classAttendance, 0).semester).toMatchObject({
      label: "III Semester",
    });
  });
  test("a page with no SGPAs at all is refused rather than guessed", async () => {
    const { reader } = fake({ studentProfile: CLASS_PAGE_NO_SGPA });
    const reply = await handleFind(reader, {
      roll: "21CS001",
      from: "01/10/2025",
      to: "22/10/2025",
    });
    expect(reply.class).toBeNull();
    expect(reply.student).toBeNull();
    expect(reply.note).toContain("semester");
  });
  test("no SGPAs refuses even where the first semester is offered", async () => {
    // The old guess read "no completed semesters" as "headed for the first",
    // so offering it would have produced a class. Refusal names the gap.
    const { reader, calls } = fake({
      studentProfile: CLASS_PAGE_NO_SGPA,
      semester: [opt("1", "I Semester")],
    });
    const reply = await handleFind(reader, {
      roll: "21CS001",
      from: "01/10/2025",
      to: "22/10/2025",
    });
    expect(reply.class).toBeNull();
    expect(reply.student).toBeNull();
    expect(reply.note).toContain("semester");
    expect(calls.register).toEqual([]);
  });
});
