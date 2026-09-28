import { test, expect } from "@playwright/test";

import { HttpError } from "../portal-replies";
import { handleOptions, handleRegister, requireLevels } from "../server-routes";
import type { PortalReader } from "../server-routes";
import type { Option, RegisterRequest } from "../shared/api";

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
};
const oneRow = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
<tr><td>1</td><td>21CS001</td><td>A Student</td><td>38/45</td><td>84.44</td></tr></table>`;
const fake = (
  answers: {
    course?: Option[];
    branch?: Option[];
    semester?: Option[];
    section?: Option[];
    subject?: Option[];
    register?: string;
  } = {}
): { reader: PortalReader; calls: Calls } => {
  const calls: Calls = {
    courses: 0,
    branches: 0,
    sections: [],
    subjects: [],
    register: [],
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
      expect(reply.subject).toHaveLength(1);
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
