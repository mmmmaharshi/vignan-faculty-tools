import { expect, test } from "@playwright/test";

import { HttpError } from "../server/portal-replies";
import { handleOptions, handleRegister } from "../server/server-routes";
import type { PortalReader } from "../server/server-routes";
import { ALL_SUBJECTS } from "../shared/api";
import {
  classGrid,
  deadSession,
  fake,
  levels,
  nth,
  oneRow,
  opt,
  resolved,
  subjectGrid,
  twoRows,
} from "./support/routes-fake";

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
  test("each subject column shows that subject's stated percentage", async () => {
    const offered = [opt("9", "AI"), opt("11", "DWDM")];
    const { reader, calls } = fake({
      classAttendance: `<table>
        <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>DWDM</th><th>Total</th><th>Percent</th></tr>
        <tr><td>1</td><td>21CS001</td><td>Name 1</td><td>37</td><td>10</td><td>381\\481</td><td>79.21</td></tr>
        <tr><td>2</td><td>21CS002</td><td>Name 2</td><td>35</td><td>10</td><td>356\\481</td><td>74.01</td></tr>
      </table>`,
      offeredSubjects: offered,
      subjectReports: {
        "9": subjectGrid("AI", [
          ["21CS001", "90"],
          ["21CS002", "80"],
        ]),
        "11": subjectGrid("DWDM", [
          ["21CS001", "70"],
          ["21CS002", "60"],
        ]),
      },
    });
    const reply = await handleRegister(reader, levels({ subject: ALL }));
    expect(
      calls.subjectReports.toSorted(),
      "one report read per offered subject, in one parallel fan-out"
    ).toEqual(["11", "9"]);
    expect(reply.summary.subjectColumns).toEqual(["AI", "DWDM"]);
    expect(reply.students[0]?.subjects).toEqual([90, 70]);
    expect(reply.students[1]?.subjects).toEqual([80, 60]);
  });
  test("a subject the portal's own list does not offer names no column", async () => {
    const { reader } = fake({
      classAttendance: `<table>
        <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>VAC</th><th>Total</th><th>Percent</th></tr>
        <tr><td>1</td><td>21CS001</td><td>Name 1</td><td>37</td><td>1</td><td>381\\481</td><td>79.21</td></tr>
      </table>`,
      offeredSubjects: [opt("9", "AI")],
      subjectReports: { "9": subjectGrid("AI", [["21CS001", "90"]]) },
    });
    const reply = await handleRegister(reader, levels({ subject: ALL }));
    expect(reply.summary.subjectColumns).toEqual(["AI"]);
    expect(reply.students[0]?.subjects).toEqual([90]);
  });
  test("a subject report ECAP will not give leaves dashes, not a failed register", async () => {
    const { reader } = fake({
      offeredSubjects: [opt("9", "AI")],
      subjectFails: ["9"],
    });
    const reply = await handleRegister(reader, levels({ subject: ALL }));
    expect(reply.summary.subjectColumns).toEqual(["AI"]);
    expect(reply.students[0]?.subjects).toEqual([null]);
  });
  test("a subject listing ECAP will not give still names its columns", async () => {
    const { reader } = fake({
      offeredFails: true,
    });
    const reply = await handleRegister(reader, levels({ subject: ALL }));
    // The class report did state AI: the column stays, only its figures are
    // unknown — the same dash a failed subject report earns.
    expect(reply.summary.subjectColumns).toEqual(["AI"]);
    expect(reply.students[0]?.subjects).toEqual([null]);
    expect(reply.summary.total).toBe(1);
  });
  test("a dead session during a subject read still signs out", async () => {
    const { reader: base } = fake();
    const reader: PortalReader = {
      ...base,
      subjectReport: () => Promise.reject(new HttpError(401, "expired")),
    };
    const failure = await handleRegister(
      reader,
      levels({ subject: ALL })
    ).catch((error: unknown) => error);
    expect((failure as HttpError).status).toBe(401);
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
