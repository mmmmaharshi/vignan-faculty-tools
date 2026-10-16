import { test, expect } from "@playwright/test";

import { HttpError } from "../portal-replies";
import {
  handleOptions,
  handleRegister,
  handleStudentProfile,
  requireLevels,
} from "../server-routes";
import type { PortalReader } from "../server-routes";
import type { Option, RegisterRequest } from "../shared/api";
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
    const reply = await handleOptions(flaky, {});
    expect(reply.course).toEqual([]);
    expect(reply.emptyLevels).toContain("course");
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
      phones: [],
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
