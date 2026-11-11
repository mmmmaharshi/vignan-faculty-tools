import { expect, test } from "@playwright/test";

import { handleOptions } from "../server/class-routes";
import { HttpError } from "../server/http-error";
import type { PortalReader } from "../server/portal-reader";
import { requireLevels } from "../server/register-levels";
import { ALL_SUBJECTS } from "../shared/api";
import { fake, levels, nth, opt } from "./support/routes-fake";

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
  test("held lists are used as stated, and only the missing levels are asked for", () => {
    const { reader, calls } = fake();
    const held = {
      course: [opt("1", "B.Tech")],
      branch: [opt("6", "IT")],
      semester: [opt("3", "III")],
    };
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
      held,
    }).then((reply) => {
      expect(calls.courses, "courses travelled, so ECAP is not asked").toBe(0);
      expect(calls.branches, "the pair travelled, so ECAP is not asked").toBe(
        0
      );
      expect(
        calls.sections,
        "sections are missing, so ECAP is asked"
      ).toHaveLength(1);
      expect(reply.course).toEqual(held.course);
      expect(reply.branch).toEqual(held.branch);
      expect(reply.semester).toEqual(held.semester);
    });
  });
  test("half a pair is no pair: one held level still fetches both", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, {
      course: "1",
      held: { branch: [opt("6", "IT")] },
    }).then((reply) => {
      expect(
        calls.branches,
        "branches and semesters arrive in one reply, so one held list cannot stand in for both"
      ).toBe(1);
      expect(reply.branch).toHaveLength(1);
    });
  });
  test("an empty held list is fetched, never taken as a known empty", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, { held: { course: [] } }).then(() => {
      expect(
        calls.courses,
        "an empty list states nothing, so the Portal is asked"
      ).toBe(1);
    });
  });
  test("a held subject list keeps its single ALL SUBJECTS lead", () => {
    const { reader, calls } = fake();
    const held = {
      course: [opt("1", "B.Tech")],
      branch: [opt("6", "IT")],
      semester: [opt("3", "III")],
      section: [opt("1", "Section-1")],
      subject: [ALL_SUBJECTS, opt("57", "MFCS")],
    };
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
      section: "1",
      held,
    }).then((reply) => {
      expect(
        calls.subjects,
        "the list travelled, so ECAP is not asked"
      ).toHaveLength(0);
      expect(
        reply.subject.filter((o) => o.value === ALL_SUBJECTS.value),
        "reusing a reply reads the same: one lead entry, not two"
      ).toHaveLength(1);
    });
  });
  test("a request holding every list still proves the session", async () => {
    const { reader, calls } = fake({ course: [] });
    const held = {
      course: [opt("1", "B.Tech")],
      branch: [opt("6", "IT")],
      semester: [opt("3", "III")],
      section: [opt("1", "Section-1")],
      subject: [opt("57", "MFCS")],
    };
    const failure = await handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
      section: "1",
      held,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpError);
    expect((failure as HttpError).status).toBe(401);
    expect(calls.courses, "the verdict is still asked for").toBe(1);
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
  test("a semester the list states no title for asks with no batch", () => {
    const { reader, calls } = fake();
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
    }).then(() => {
      expect(nth(calls.sections, 0)[3]).toBeUndefined();
    });
  });
  test("the batch comes from the Portal's own list, so a stale one cannot ask the wrong batch", () => {
    // The client sends the title it remembers, and a cascade that has not
    // settled yet sends none at all. What this call just fetched is the only
    // statement of the batch that matters.
    const { reader, calls } = fake({
      semester: [opt("3", "III Semester", "2025")],
    });
    return handleOptions(reader, {
      course: "1",
      branch: "6",
      semester: "3",
      semesterTitle: "1999",
    }).then(() => {
      expect(nth(calls.sections, 0)[3]).toBe("2025");
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
