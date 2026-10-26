import { test, expect } from "@playwright/test";

import type { DayWorkRequest } from "../server/portal-conventions";
import { HttpError } from "../server/portal-replies";
import {
  handleFind,
  handleOptions,
  handleRegister,
  handleSemAbsences,
  handleSemStart,
  handleStudentProfile,
  handleTodayClasses,
  handleUnposted,
  requireLevels,
} from "../server/server-routes";
import type { PortalReader } from "../server/server-routes";
import type {
  Option,
  RegisterRequest,
  SemAbsencesRequest,
  SemStartRequest,
} from "../shared/api";
import { ALL_SUBJECTS } from "../shared/api";

const opt = (value: string, label = `L${value}`, title = ""): Option => ({
  value,
  label,
  title,
});
const resolved = <T>(value: T): Promise<T> => Promise.resolve(value);
const nth = <T>(list: readonly T[], n: number): T => {
  const hit = list[n];
  if (hit === undefined) {
    throw new Error(`expected at least ${n + 1} call(s), got ${list.length}`);
  }
  return hit;
};
type Calls = {
  courses: number;
  branches: number;
  sections: [string, string, string, string | undefined][];
  subjects: [string, string, string][];
  register: (RegisterRequest & Record<string, unknown>)[];
  classAttendance: (RegisterRequest & Record<string, unknown>)[];
  studentProfile: string[];
  studentWise: [string, string][];
  /** The window each Student Wise read was asked over. */
  studentWiseWindows: { from: string; to: string }[];
  /** What each day-class-work read was asked for. */
  dayWork: DayWorkRequest[];
};
const oneRow = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
<tr><td>1</td><td>21CS001</td><td>A Student</td><td>38/45</td><td>84.44</td></tr></table>`;
const twoRows = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
<tr><td>1</td><td>21CS001</td><td>A Student</td><td>38/45</td><td>84.44</td></tr>
<tr><td>2</td><td>21CS002</td><td>B Student</td><td>20/45</td><td>44.44</td></tr></table>`;
const classGrid = (rows: [string, string, string][]): string =>
  `<table>
    <tr><td>ATTENDANCE REPORT FOR THE PERIOD OF</td></tr>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>Total</th><th>Percent</th></tr>
    <tr><td>Batch-1</td><td>50</td><td>0</td><td>49</td><td></td><td></td></tr>
    ${rows
      .map(
        ([roll, total, pct], i) =>
          `<tr><td>${i + 1}</td><td>${roll}</td><td>Name ${i + 1}</td><td>37</td><td>${total}</td><td>${pct}</td></tr>`
      )
      .join("")}
  </table>`;
const ONE_CLASS_ROW = classGrid([["21CS001", "381\\481", "79.21"]]);
/** Enough of the StudentProfile page for the handler: parsing is covered where
 *  the parser is, over the real page. */
const PROFILE_PAGE = `<div id='divProfile_BioData'><table>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;5.61&nbsp;&nbsp;&nbsp;Credits:16/19&nbsp;&nbsp;&nbsp;&nbsp;48.55&nbsp;%</span></center></div>`;
/** A Student Wise report: one row per subject, one column per day the section
 *  met, and one mark per period inside a cell. MFCS says `A` on 05/08 and SE on
 *  06/08, so the student missed both dates, each once. */
const STUDENT_GRID = `<table>
<tr><th>Sl.No</th><th>Subject</th><th>05/08</th><th>06/08</th><th>07/08</th><th>Atted/Held</th><th>%</th></tr>
<tr><td>1</td><td>MFCS</td><td>P&nbsp;P</td><td>A&nbsp;A</td><td>-</td><td>12/14</td><td>85.71</td></tr>
<tr><td>2</td><td>SE</td><td>A</td><td>P</td><td>P</td><td>10/14</td><td>71.43</td></tr>
</table>`;
const fake = (
  answers: {
    course?: Option[];
    branch?: Option[];
    semester?: Option[];
    section?: Option[];
    subject?: Option[];
    register?: string;
    classAttendance?: string;
    classFails?: boolean;
    studentProfile?: string;
    studentWise?: string;
    /** The dashboard's schedule fragment for today. */
    today?: string;
    /** The day-class-work report's fragment for the branch and date. */
    dayWork?: string;
    /** A Student Wise grid per month-step start, so the walk can be driven
     *  month by month. A month missing from the map answers empty, which is
     *  what stops the walk. */
    studentWiseMonths?: Record<string, string>;
    studentFails?: boolean;
  } = {}
): { reader: PortalReader; calls: Calls } => {
  const calls: Calls = {
    courses: 0,
    branches: 0,
    sections: [],
    subjects: [],
    register: [],
    classAttendance: [],
    studentProfile: [],
    studentWise: [],
    studentWiseWindows: [],
    dayWork: [],
  };
  const reader: PortalReader = {
    courses: () => {
      calls.courses += 1;
      return resolved(answers.course ?? [opt("1", "B.Tech")]);
    },
    branchesAndSemesters: () => {
      calls.branches += 1;
      return resolved([
        answers.branch ?? [opt("6", "IT")],
        answers.semester ?? [opt("3", "III")],
      ]);
    },
    sections: (c, b, s, title) => {
      calls.sections.push([c, b, s, title]);
      return resolved(answers.section ?? [opt("1", "Section-1")]);
    },
    subjects: (c, b, s) => {
      calls.subjects.push([c, b, s]);
      return resolved(answers.subject ?? [opt("57", "MFCS")]);
    },
    register: (p) => {
      calls.register.push(p as RegisterRequest & Record<string, unknown>);
      return resolved(answers.register ?? oneRow);
    },
    classAttendance: (p) => {
      calls.classAttendance.push(
        p as RegisterRequest & Record<string, unknown>
      );
      if (answers.classFails) {
        return Promise.reject(new HttpError(502, "class report unavailable"));
      }
      return resolved(answers.classAttendance ?? ONE_CLASS_ROW);
    },
    studentProfile: (roll) => {
      calls.studentProfile.push(roll);
      return resolved(answers.studentProfile ?? PROFILE_PAGE);
    },
    studentWise: (roll, name, p) => {
      calls.studentWise.push([roll, name]);
      calls.studentWiseWindows.push({ from: p.from, to: p.to });
      if (answers.studentFails) {
        return Promise.reject(new HttpError(502, "student report unavailable"));
      }
      return resolved(
        answers.studentWiseMonths?.[p.from] ??
          answers.studentWise ??
          STUDENT_GRID
      );
    },
    facultyProfile: () =>
      resolved({
        name: "Test Faculty",
        photo: "",
        designation: "0",
        leaveStatus: [],
      }),
    todayClasses: () => resolved(answers.today ?? ""),
    dayClassWork: (p) => {
      calls.dayWork.push(p);
      return resolved(answers.dayWork ?? "");
    },
  };
  return { reader, calls };
};
const levels = (partial: Partial<RegisterRequest> = {}): RegisterRequest => ({
  course: opt("1", "B.Tech"),
  semester: opt("3", "III Semester", "2025"),
  branch: opt("6", "Information Technology"),
  section: opt("1", "Section-1"),
  subject: opt("57", "MFCS", "Theory"),
  from: "01/01/2026",
  to: "28/09/2026",
  ...partial,
});
const semAbsencesAsked = (
  roll = "21CS001",
  partial: Partial<RegisterRequest> = {}
): SemAbsencesRequest => ({
  roll,
  name: "A",
  register: levels(partial),
  from: "05/08/2026",
});
test.describe("the options ladder", () => {
  test("course alone, so nothing below it is asked for", () => {
    const { reader, calls } = fake();
    const reply = handleOptions(reader, {});
    expect(calls.courses).toBe(1);
    expect(calls.branches).toBe(0);
    expect(calls.sections).toHaveLength(0);
    expect(calls.subjects).toHaveLength(0);
    return expect(reply).resolves.toMatchObject({
      course: [{ value: "1" }],
      semester: [],
      branch: [],
      section: [],
      subject: [],
    });
  });
  test("a course gets branches and semesters, still nothing below", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, { course: "1" }).then((reply) => {
      expect(calls.branches).toBe(1);
      expect(calls.sections).toHaveLength(0);
      expect(reply.branch).toHaveLength(1);
      expect(reply.semester).toHaveLength(1);
      expect(reply.section).toEqual([]);
      expect(reply.subject).toEqual([]);
    });
  });
  test("branch without a semester does not get a section list", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, { course: "1", branch: "6" }).then((reply) => {
      expect(calls.sections).toHaveLength(0);
      expect(reply.section).toEqual([]);
      expect(reply.subject).toEqual([]);
    });
  });
  test("course, branch and semester get a section list, still no subjects", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
    }).then((reply) => {
      expect(calls.sections).toHaveLength(1);
      expect(calls.subjects).toHaveLength(0);
      expect(reply.section).toHaveLength(1);
      expect(reply.subject).toEqual([]);
    });
  });
  test("all four gets subjects, which is the deepest the ladder goes", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
      section: "1",
    }).then((reply) => {
      expect(calls.subjects).toEqual([["1", "6", "3"]]);
      expect(reply.subject[0]?.value).toBe("__all__");
      expect(reply.subject.map((o) => o.label)).toEqual([
        "ALL SUBJECTS",
        "MFCS",
      ]);
    });
  });
  test("the semester's title is passed on, because it carries the batch number", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
      semesterTitle: "2025",
    }).then(() => {
      expect(nth(calls.sections, 0)[3]).toBe("2025");
    });
  });
  test("an absent title arrives as absent, not as an empty string", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
    }).then(() => {
      expect(nth(calls.sections, 0)[3]).toBeUndefined();
    });
  });
  test("every level comes back on every call, empty rather than absent", () => {
    const { reader } = fake();
    return handleOptions(reader, { course: "1" }).then((reply) => {
      for (const key of [
        "course",
        "semester",
        "branch",
        "section",
        "subject",
      ]) {
        expect(Array.isArray(reply[key as keyof typeof reply])).toBe(true);
      }
    });
  });
  test("a level that came back empty is named, not thrown", () => {
    const { reader } = fake({ branch: [], semester: [], section: [] });
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
    }).then((reply) => {
      expect(reply.branch).toEqual([]);
      expect(reply.section).toEqual([]);
      expect(reply.emptyLevels).toContain("branch");
      expect(reply.emptyLevels).toContain("section");
    });
  });
  test("a placeholder entry is dropped, and a real empty list is not one", () => {
    const { reader } = fake({ branch: [opt("0", "-Select-"), opt("6", "IT")] });
    return handleOptions(reader, { course: "1" }).then((reply) => {
      expect(reply.branch).toEqual([{ value: "6", label: "IT", title: "" }]);
      expect(reply.emptyLevels).not.toContain("branch");
    });
  });
  test("a 502 does not sign anyone out", async () => {
    const { reader } = fake({
      register: undefined,
    });
    const flaky: PortalReader = {
      ...reader,
      courses: () => Promise.reject(new HttpError(502, "unreadable reply")),
    };
    const failure = await handleOptions(flaky, {}).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(502);
  });
  test("an empty course list is a dead session, not a layout change", async () => {
    const { reader: noCourses } = fake({ course: [] });
    await expect(handleOptions(noCourses, {})).rejects.toThrow(
      /session expired/i
    );
    const { reader: placeholderOnly } = fake({
      course: [opt("0", "-Select-")],
    });
    await expect(handleOptions(placeholderOnly, {})).rejects.toThrow(
      /session expired/i
    );
    const { reader: real } = fake();
    const reply = await handleOptions(real, {});
    expect(reply.course.length).toBeGreaterThan(0);
    expect(reply.emptyLevels).not.toContain("course");
  });
});
test.describe("the register handler", () => {
  test("reads the register and summarises it in one go", () => {
    const { reader, calls } = fake();
    return handleRegister(
      reader,
      levels({ from: "01/01/2026", to: "28/09/2026" })
    ).then((reply) => {
      expect(calls.register).toHaveLength(1);
      expect(reply.students).toHaveLength(1);
      expect(nth(reply.students, 0).roll).toBe("21CS001");
      expect(reply.summary.total).toBe(1);
      expect(reply.summary.irregularBelow).toBe(75);
    });
  });
  test("every level travels whole, so the portal gets its labels", () => {
    const { reader, calls } = fake();
    return handleRegister(
      reader,
      levels({ from: "01/01/2026", to: "28/09/2026" })
    ).then(() => {
      expect(nth(calls.register, 0).subject).toEqual({
        value: "57",
        label: "MFCS",
        title: "Theory",
      });
      expect(nth(calls.register, 0).course.label).toBe("B.Tech");
    });
  });
  test("a missing level names itself, so the warning can point at it", async () => {
    const { reader, calls } = fake();
    await expect(
      handleRegister(reader, levels({ branch: undefined }))
    ).rejects.toThrow("Choose a branch.");
    expect(calls.register).toHaveLength(0);
  });
  test("a level with a value but no label is refused, because the portal needs both", () => {
    const { reader } = fake();
    return expect(
      handleRegister(
        reader,
        levels({
          subject: { value: "57", label: "", title: "Theory" },
          from: "01/01/2026",
          to: "28/09/2026",
        })
      )
    ).rejects.toThrow("Choose a subject.");
  });
  test("no date range is refused before anything is read", () => {
    const { reader } = fake();
    return expect(handleRegister(reader, levels({ from: "" }))).rejects.toThrow(
      "Choose a date range."
    );
  });
  test("an empty register names both causes, not just the likely one", () => {
    const { reader } = fake({ register: "<p>nothing here</p>" });
    return expect(
      handleRegister(reader, levels({ from: "01/01/2026", to: "28/09/2026" }))
    ).rejects.toThrow(/no classes in that date range[\s\S]*layout has changed/);
  });
  test("an HttpError carries the status the route will answer with", async () => {
    const { reader } = fake({ register: "<p>nothing</p>" });
    const failure = await handleRegister(
      reader,
      levels({ from: "01/01/2026", to: "28/09/2026" })
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(502);
  });
});
const deadSession = () =>
  Promise.reject(new HttpError(401, "Your ECAP session expired."));
test.describe("the overall column", () => {
  test("each student carries the overall percentage the portal stated for them", async () => {
    const { reader, calls } = fake({
      register: twoRows,
      classAttendance: classGrid([
        ["21CS001", "381\\481", "79.21"],
        ["21CS002", "356\\481", "74.01"],
      ]),
    });
    const reply = await handleRegister(reader, levels());
    expect(reply.students.map((s) => [s.roll, s.overallPct])).toEqual([
      ["21CS001", 79.21],
      ["21CS002", 74.01],
    ]);
    expect(calls.classAttendance).toHaveLength(1);
  });
  test("a student the class report never mentions keeps their row and no figure", async () => {
    const { reader } = fake({ register: twoRows });
    const reply = await handleRegister(reader, levels());
    expect(reply.students).toHaveLength(2);
    expect(reply.students[0]?.overallPct).toBe(79.21);
    expect(reply.students[1]?.overallPct).toBeNull();
    expect(reply.students[1]?.overallIrregular).toBe(false);
    expect(reply.students[1]?.overallCritical).toBe(false);
  });
  test("a student the class report adds is not put into the register", async () => {
    const { reader } = fake({
      register: oneRow,
      classAttendance: classGrid([
        ["21CS001", "381\\481", "79.21"],
        ["21CS999", "100\\481", "20.79"],
      ]),
    });
    const reply = await handleRegister(reader, levels());
    expect(reply.students).toHaveLength(1);
    expect(reply.students[0]?.roll).toBe("21CS001");
    expect(reply.summary.total).toBe(1);
  });
  test("the class report is asked for over the same range, carrying the chosen labels", async () => {
    const { reader, calls } = fake();
    await handleRegister(
      reader,
      levels({ from: "01/06/2026", to: "29/09/2026" })
    );
    const asked = nth(calls.classAttendance, 0);
    expect(asked.from).toBe("01/06/2026");
    expect(asked.to).toBe("29/09/2026");
    expect(asked.branch.label).toBe("Information Technology");
    expect(asked.section.label).toBe("Section-1");
    expect(asked.semester.label).toBe("III Semester");
  });
  test("a class report that fails leaves the register standing", async () => {
    const { reader } = fake({ classFails: true });
    const reply = await handleRegister(reader, levels());
    expect(reply.students).toHaveLength(1);
    expect(reply.students[0]?.overallPct).toBeNull();
    expect(reply.summary.total).toBe(1);
  });
  test("a dead session stays a 401 on both paths, so the client signs out", async () => {
    const { reader } = fake();
    const subjectPath: PortalReader = {
      ...reader,
      register: () => resolved(oneRow),
      classAttendance: deadSession,
    };
    await expect(handleRegister(subjectPath, levels())).rejects.toThrow(
      /session expired/i
    );
    const allPath: PortalReader = {
      ...reader,
      register: () => resolved(oneRow),
      classAttendance: deadSession,
    };
    const failure = await handleRegister(
      allPath,
      levels({ subject: ALL_SUBJECTS })
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(401);
  });
  test("one class read per register load, not one per student", async () => {
    const { reader, calls } = fake({
      register: twoRows,
      classAttendance: classGrid([
        ["21CS001", "381\\481", "79.21"],
        ["21CS002", "356\\481", "74.01"],
      ]),
    });
    await handleRegister(reader, levels());
    expect(calls.classAttendance).toHaveLength(1);
    expect(calls.register).toHaveLength(1);
  });
});
test.describe("all subjects", () => {
  const ALL = ALL_SUBJECTS;
  const deep = { course: "1", branch: "6", semester: "3", section: "1" };
  test("it leads the list, so the whole section is one click away", () => {
    const { reader } = fake();
    return handleOptions(reader, deep).then((reply) => {
      expect(reply.subject).toHaveLength(2);
      expect(reply.subject[0]).toEqual(ALL_SUBJECTS);
      expect(reply.subject.at(-1)?.label).toBe("MFCS");
    });
  });
  test("a section with no subjects does not gain the entry", () => {
    const { reader } = fake({ subject: [] });
    return handleOptions(reader, deep).then((reply) => {
      expect(reply.subject).toEqual([]);
      expect(reply.emptyLevels).toContain("subject");
    });
  });
  test("choosing it reads the class report and no subject register", async () => {
    const { reader, calls } = fake();
    await handleRegister(reader, levels({ subject: ALL }));
    expect(calls.register).toHaveLength(0);
    expect(calls.classAttendance).toHaveLength(1);
  });
  test("its rows are the class report's own students, with no subject figure", async () => {
    const { reader } = fake({
      classAttendance: classGrid([
        ["21CS001", "381\\481", "79.21"],
        ["21CS002", "356\\481", "74.01"],
      ]),
    });
    const reply = await handleRegister(reader, levels({ subject: ALL }));
    expect(reply.students.map((s) => s.roll)).toEqual(["21CS001", "21CS002"]);
    expect(reply.students[0]?.name).toBe("Name 1");
    expect(reply.students[0]?.pct).toBeNull();
    expect(reply.students[0]?.attendedOfHeld).toBe("");
    expect(reply.students[0]?.overallPct).toBe(79.21);
    expect(reply.students[0]?.irregular).toBe(false);
    expect(reply.students[0]?.overallIrregular).toBe(false);
    expect(reply.students[1]?.overallIrregular).toBe(true);
  });
  test("the overall figures are in the summary and the subject ones are empty", async () => {
    const { reader } = fake({
      classAttendance: classGrid([
        ["21CS001", "381\\481", "90"],
        ["21CS002", "356\\481", "74.01"],
      ]),
    });
    const reply = await handleRegister(reader, levels({ subject: ALL }));
    expect(reply.summary.total).toBe(2);
    expect(reply.summary.overallIrregular).toBe(1);
    expect(reply.summary.overallAverage).toBe(82);
    expect(reply.summary.average).toBeNull();
    expect(reply.summary.irregular).toBe(0);
  });
  test("the class report states no dates, so the all-subjects summary names none", async () => {
    const { reader } = fake({
      classAttendance: classGrid([["21CS001", "381\\481", "90"]]),
    });
    const reply = await handleRegister(reader, levels({ subject: ALL }));
    expect(reply.summary.classesHeld).toBeNull();
  });
  test("the summary carries the register grid's own class-day count", async () => {
    const dated = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>10/10</th><th>12/10</th><th>Attend / Held</th><th>%</th></tr>
    <tr><td>1</td><td>21CS001</td><td>A Student</td><td>P</td><td>A</td><td>1/2</td><td>50</td></tr></table>`;
    const { reader } = fake({ register: dated });
    const reply = await handleRegister(
      reader,
      levels({ from: "01/01/2026", to: "28/10/2026" })
    );
    expect(reply.summary.classesHeld).toBe(2);
    expect(
      reply.summary.statedFrom,
      "the register's own first date, with the range's year"
    ).toBe("10/10/2026");
  });
  test("a register grid with no date columns leaves the count absent, not zero", async () => {
    const { reader } = fake({ register: oneRow });
    const reply = await handleRegister(reader, levels());
    expect(reply.summary.classesHeld).toBeNull();
    expect(reply.summary.statedFrom).toBeNull();
  });
  test("a class report with nothing in it is a 502, not an empty table", async () => {
    const { reader } = fake({ classAttendance: "<p>nothing here</p>" });
    await expect(
      handleRegister(reader, levels({ subject: ALL }))
    ).rejects.toThrow(/class/i);
  });
});
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
test.describe("the semester start probe", () => {
  const GRID = `<table>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Name</th><th>05/08</th><th>06/08</th><th>Attend/Held</th><th>%</th></tr>
    <tr><td>1</td><td>21CS001</td><td>A</td><td>P</td><td>A</td><td>1/2</td><td>50</td></tr>
  </table>`;
  test("one subject's earliest held day, resolved into the asked range", async () => {
    const { reader, calls } = fake({ register: GRID });
    const reply = await handleSemStart(
      reader,
      levels({ from: "01/05/2026", to: "18/10/2026" })
    );
    expect(calls.register, "one grid read, never a roster").toHaveLength(1);
    expect(reply).toEqual({ statedFrom: "05/08/2026" });
  });
  test("a grid that states no dates states no start, not a wrong one", async () => {
    const { reader } = fake();
    const reply = await handleSemStart(reader, levels());
    expect(reply).toEqual({ statedFrom: null });
  });
  test("no date range is refused before the portal is asked", async () => {
    const { reader, calls } = fake();
    await expect(handleSemStart(reader, levels({ from: "" }))).rejects.toThrow(
      "Choose a date range."
    );
    expect(calls.register).toHaveLength(0);
  });
  test("a dead session stays a 401, so the client signs out", async () => {
    const { reader } = fake();
    const dead: PortalReader = {
      ...reader,
      register: () => Promise.reject(new HttpError(401, "expired")),
    };
    const failure = await handleSemStart(dead, levels()).catch(
      (error: unknown) => error
    );
    expect((failure as HttpError).status).toBe(401);
  });
});
const walkDated = (date: string): string => `<table>
    <tr><th>Sl.No</th><th>Roll.No</th><th>Name</th><th>${date}</th><th>Attend/Held</th><th>%</th></tr>
    <tr><td>1</td><td>21CS001</td><td>A</td><td>P</td><td>1/1</td><td>100</td></tr>
  </table>`;
const walked = (extra: Record<string, unknown> = {}): SemStartRequest => ({
  ...levels({ from: "01/10/2026", to: "18/10/2026" }),
  walkBack: 2,
  ...extra,
});
test.describe("the semester start walk", () => {
  const dateless =
    "<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>" +
    "<tr><td>1</td><td>21CS001</td><td>A Student</td><td>0/0</td><td>0</td></tr></table>";
  const walking = (grids: Record<string, string>) => {
    const { reader } = fake();
    const months: { from: string; to: string }[] = [];
    const walkingReader: PortalReader = {
      ...reader,
      register: (p) => {
        months.push({ from: p.from, to: p.to });
        return Promise.resolve(grids[p.from] ?? dateless);
      },
    };
    return { reader: walkingReader, months };
  };
  test("walks back month by month to the first held day", async () => {
    const { reader, months } = walking({
      "01/10/2026": walkDated("12/10"),
      "01/09/2026": walkDated("03/09"),
    });
    const reply = await handleSemStart(reader, walked());
    expect(reply).toEqual({ statedFrom: "03/09/2026" });
    // The asked month plus two before it, each a month-shaped read — and the
    // dateless August stops the walk instead of being read past.
    expect(months).toEqual([
      { from: "01/10/2026", to: "31/10/2026" },
      { from: "01/09/2026", to: "30/09/2026" },
      { from: "01/08/2026", to: "31/08/2026" },
    ]);
  });
  test("a dateless asked month states no start after one read", async () => {
    const { reader, months } = walking({});
    const reply = await handleSemStart(reader, walked());
    expect(reply).toEqual({ statedFrom: null });
    expect(months).toHaveLength(1);
  });
  test("no walkBack reads the asked window alone, unshaped", async () => {
    const { reader, months } = walking({ "01/10/2026": walkDated("12/10") });
    const reply = await handleSemStart(
      reader,
      levels({ from: "01/10/2026", to: "18/10/2026" })
    );
    expect(reply).toEqual({ statedFrom: "12/10/2026" });
    expect(months).toEqual([{ from: "01/10/2026", to: "18/10/2026" }]);
  });
  test("the walk never exceeds twelve months back", async () => {
    const { reader, months } = walking({});
    const everDated: PortalReader = {
      ...reader,
      register: (p) => {
        months.push({ from: p.from, to: p.to });
        const [, mm] = p.from.split("/");
        return Promise.resolve(walkDated(`15/${mm}`));
      },
    };
    const reply = await handleSemStart(
      everDated,
      walked({ to: "18/10/2026", walkBack: 99 })
    );
    expect(months, "the asked month plus twelve before it").toHaveLength(13);
    expect(reply).toEqual({ statedFrom: "15/10/2025" });
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
test.describe("the levels a register needs", () => {
  test("all five, each with both halves", () => {
    const got = requireLevels(levels());
    expect(Object.keys(got).toSorted()).toEqual([
      "branch",
      "course",
      "section",
      "semester",
      "subject",
    ]);
    for (const k of Object.values(got)) {
      expect(k.value).toBeTruthy();
      expect(k.label).toBeTruthy();
    }
  });
  test("refuses the first level that is incomplete, in cascade order", () => {
    expect(() => requireLevels({})).toThrow("Choose a course.");
    expect(() => requireLevels({ course: opt("1", "B.Tech") })).toThrow(
      "Choose a semester."
    );
    expect(() =>
      requireLevels({ course: opt("1", "B.Tech"), semester: opt("3", "III") })
    ).toThrow("Choose a branch.");
  });
});

/** A profile page that states the class, which the real one is expected to: the
 *  search has nothing to resolve without it. */
const CLASS_PAGE = `<div id='divProfile_BioData'><table>
<tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
<tr><td>Branch</td><td>:</td><td>IT</td></tr>
<tr><td>Semester</td><td>:</td><td>III</td></tr>
<tr><td>Section</td><td>:</td><td>Section-1</td></tr>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;5.61&nbsp;&nbsp;&nbsp;Credits:16/19&nbsp;&nbsp;&nbsp;&nbsp;48.55&nbsp;%</span></center></div>`;
const ask = { from: "01/10/2025", to: "22/10/2025" };
/** A Student Wise month: one meeting day, missed, so the walk keeps going. */
const monthGrid = (date: string): string => `<table>
<tr><th>Sl.No</th><th>Subject</th><th>${date}</th><th>Atted/Held</th><th>%</th></tr>
<tr><td>1</td><td>MFCS</td><td>A</td><td>0/1</td><td>0</td></tr></table>`;
test.describe("a roll number searched on its own", () => {
  test("find reads no subject register, only the class report", async () => {
    const { reader, calls } = fake({ studentProfile: CLASS_PAGE });
    await handleFind(reader, { roll: "21CS001", ...ask });
    // The semester start comes off the section's own grid, month by month —
    // never a subject register over a wide range, which ECAP answers empty.
    expect(calls.register).toEqual([]);
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

const CLASS_PAGE_NO_SEM = `<div id='divProfile_BioData'><table>
<tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
<tr><td>Branch</td><td>:</td><td>IT</td></tr>
<tr><td>Section</td><td>:</td><td>Section-1</td></tr>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;8.05&nbsp;&nbsp;&nbsp;Credits:40/40&nbsp;&nbsp;&nbsp;&nbsp;73.00&nbsp;%</span></center>
<span>II Semester</span><table><tr><th>X</th><th>SGPA</th></tr><tr><td>Grade</td><td>7.66</td></tr></table></div>`;
const CLASS_PAGE_NO_SGPA = `<div id='divProfile_BioData'><table>
<tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
<tr><td>Branch</td><td>:</td><td>IT</td></tr>
<tr><td>Section</td><td>:</td><td>Section-1</td></tr>
<tr><td>Mobile.No</td><td>:</td><td>7661864881</td></tr></table>
<center><span>CGPA:&nbsp;8.05&nbsp;&nbsp;&nbsp;Credits:40/40&nbsp;&nbsp;&nbsp;&nbsp;73.00&nbsp;%</span></center></div>`;
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
test.describe("the today handler", () => {
  test("a cleared evening answers an empty day, not a failure", async () => {
    // ECAP's own answer after ~4pm, read live 2026-10-23.
    const { reader } = fake({ today: "</table>" });
    await expect(handleTodayClasses(reader)).resolves.toEqual({ classes: [] });
  });
  test("a portal refusal stays a refusal, never an empty day", async () => {
    const { reader: base } = fake();
    const reader: PortalReader = {
      ...base,
      todayClasses: () => Promise.reject(new HttpError(502, "down")),
    };
    await expect(handleTodayClasses(reader)).rejects.toThrow("down");
  });
});
/** One section block with the report's own geometry: a posted period with
 *  both counts, and a held period with neither. */
const DAYWORK = `<b>Course:</b>&nbsp;B.Tech<div><b>Branch:</b>&nbsp;Information Technology</div><div><b>Semester:</b>&nbsp;III Semester</div><div><b>Section:</b>&nbsp;B</div>
<table><tr><td>Period</td><td>Subject</td><td>Name of the staff</td><td>Unit.No</td><td>Topics Covered</td><td>Present</td><td>Absent</td><td>Rolls</td></tr>
<tr><td>1</td><td>MFCS</td><td>Some One</td><td>-</td><td>-</td><td>30</td><td>5</td><td>21B</td></tr>
<tr><td>2</td><td>SE</td><td>Other Two</td><td>-</td><td>-</td><td></td><td></td><td></td></tr></table>`;
const itBranch = [
  opt("0", "-Branch-"),
  opt("6", "Information Technology", "IT"),
];
const cseBranch = opt("11", "CSE (AI)", "CSE (AI)");
const titledSemesters = [
  opt("2", "III Semester", "2025"),
  opt("4", "V Semester", "2024"),
];
test.describe("the unposted handler", () => {
  test("asks every offered branch in one call", async () => {
    const { reader, calls } = fake({
      branch: [...itBranch, cseBranch],
      semester: titledSemesters,
      dayWork: DAYWORK,
    });
    const reply = await handleUnposted(reader);
    expect(reply.date, "the campus day, not the server's").toMatch(
      /^\d\d\/\d\d\/\d\d\d\d$/
    );
    expect(reply.sections).toMatchObject([
      { branchShort: "IT", semester: "III Semester", section: "B" },
    ]);
    expect(
      reply.sections[0]?.cells,
      "posted rows tick, blank rows do not"
    ).toEqual([
      {
        period: "1",
        subject: "MFCS",
        posted: true,
        staff: "Some One",
        present: "30",
        absent: "5",
      },
      {
        period: "2",
        subject: "SE",
        posted: false,
        staff: "Other Two",
        present: "",
        absent: "",
      },
    ]);
    // The ask carries every offered branch plus every titled semester: one
    // call covers the whole day.
    expect(nth(calls.dayWork, 0)).toMatchObject({
      course: { value: "1", label: "B.Tech" },
      date: reply.date,
    });
    expect(
      nth(calls.dayWork, 0).branches.map((b) => b.value),
      "placeholders never travel"
    ).toEqual(["6", "11"]);
    expect(
      nth(calls.dayWork, 0).semesters.map((s) => s.value),
      "only semesters the Portal counts into the year travel"
    ).toEqual(["2", "4"]);
  });
  test("a portal that will not say its courses fails named", async () => {
    const { reader: base } = fake();
    const reader: PortalReader = {
      ...base,
      courses: () => Promise.reject(new HttpError(502, "unreadable reply")),
    };
    const failure = await handleUnposted(reader).catch(
      (error: unknown) => error
    );
    expect((failure as HttpError).status).toBe(502);
    await expect(handleUnposted(reader)).rejects.toThrow(/no courses/);
  });
  test("outside B.Tech the first offered course is read instead", async () => {
    const { reader, calls } = fake({
      course: [opt("9", "M.Tech")],
      branch: [opt("7", "Information Technology", "IT")],
      semester: titledSemesters,
      dayWork: DAYWORK,
    });
    const reply = await handleUnposted(reader);
    expect(
      nth(calls.dayWork, 0).course,
      "the fallback asks what ECAP offers, not B.Tech"
    ).toEqual({ value: "9", label: "M.Tech", title: "" });
    expect(reply.sections).toHaveLength(1);
  });
  test("a dead session during the read still signs out", async () => {
    const { reader } = fake({ course: [] });
    await expect(handleUnposted(reader)).rejects.toThrow(/session expired/i);
  });
  test("a portal refusal stays a refusal, never all posted", async () => {
    const { reader: base } = fake({
      branch: itBranch,
      semester: titledSemesters,
    });
    const reader: PortalReader = {
      ...base,
      dayClassWork: () => Promise.reject(new HttpError(502, "down")),
    };
    await expect(handleUnposted(reader)).rejects.toThrow("down");
  });
});
