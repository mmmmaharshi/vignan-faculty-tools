/**
 * The two route handlers, tested with no server and no portal.
 *
 * They were inline in `Bun.serve({ fetch })`, so importing `server.ts` to reach
 * them booted a server and bound the port. Nothing below had a test — and the
 * `/api/options` ladder in particular is four sequential calls gated on
 * progressively deeper conditions, which is the shape that fails quietly.
 *
 * The fake below is the second adapter behind `PortalReader`. The live `Portal`
 * is the first. That is the whole reason the handlers take an interface: the
 * ladder's conditionals can be checked without a network or a credential.
 */

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

/** Awaited, so a fake read cannot be mistaken for one that forgets to. */
const resolved = <T>(value: T): Promise<T> => Promise.resolve(value);

/**
 * The nth recorded call, or a failure that says there was no such call.
 *
 * `noUncheckedIndexedAccess` is on and it is right to be: reaching past the end
 * of a call list should read as a broken test rather than as a silent
 * `undefined` that happens to satisfy the assertion.
 */
const nth = <T>(list: readonly T[], n: number): T => {
  const hit = list[n];
  if (hit === undefined) {
    throw new Error(`expected at least ${n + 1} call(s), got ${list.length}`);
  }
  return hit;
};

/** What each portal read was asked, so a test can assert on the call itself. */
type Calls = {
  courses: number;
  branches: number;
  sections: [string, string, string, string | undefined][];
  subjects: [string, string, string][];
  register: (RegisterRequest & Record<string, unknown>)[];
};

/** A register table with one row, as the portal's markup would give it. */
const oneRow = `<table><tr><th>Sl.No</th><th>Roll No</th><th>Name</th><th>Attend / Held</th><th>%</th></tr>
<tr><td>1</td><td>21CS001</td><td>A Student</td><td>38/45</td><td>84.44</td></tr></table>`;

/**
 * A portal that answers from fixtures and records what it was asked.
 *
 * Answers are given per level so a test can say "sections exist but subjects do
 * not" without arranging a chain of conditionals in the call itself.
 */
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

/** A full, valid selection. Override any part to make it wrong. */
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
    // One course is all this account can see, and it is the state the app opens
    // in. Asking for a section here would send a request with no branch.
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
      // Still empty, not absent: the front end tells "not yet derivable" from
      // "chosen, and genuinely empty" by the difference.
      expect(reply.section).toEqual([]);
      expect(reply.subject).toEqual([]);
    });
  });

  test("branch without a semester does not get a section list", () => {
    // The gate is on all three of course, branch and semester. Dropping the
    // semester from it would ask the portal for a combination the user cannot
    // see, and the portal answers with a section list for a semester they are
    // not in.
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
    // IV Semester ships an empty title, which is why the server falls back. If
    // the title were dropped here the batch would silently be the semester
    // value - and the section list would come back from the wrong batch. This
    // is the bug the client-side optsRef fix was about.
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
    // The two are different to the caller: `?? semester` falls back on the
    // first and sends a blank on the second.
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
    // The front end indexes into all five, so a missing key would render as
    // undefined and look like a crash.
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
    // ADR 0003. Nothing observable has ever been empty, but a 502 on a course
    // nobody here has seen would block the screen for everyone.
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
    // "-Select-" is a choice that resolves to nothing. It must not be reported
    // as a real option, and its absence must not be confused with emptiness.
    const { reader } = fake({ branch: [opt("0", "-Select-"), opt("6", "IT")] });
    return handleOptions(reader, { course: "1" }).then((reply) => {
      expect(reply.branch).toEqual([{ value: "6", label: "IT", title: "" }]);
      expect(reply.emptyLevels).not.toContain("branch");
    });
  });

  test("a 502 does not sign anyone out", async () => {
    // The refusal ADR 0002 and ADR 0013 both record, and this is the layer that
    // actually decides, so it is pinned here as well as in `liveness.spec.ts`.
    // `liveness` returning `unknown` is only half the promise: a caller that
    // treats `unknown` as `dead` would still sign the user out, and that mistake
    // lives in this file, not in the module.
    const { reader } = fake({
      register: undefined,
    });
    const flaky: PortalReader = {
      ...reader,
      courses: () => Promise.reject(new HttpError(502, "unreadable reply")),
    };
    // The refusal survives: a 502 is `unknown`, so the ladder is served with the
    // course level empty and reported in `emptyLevels` — which is the honest
    // report for a portal that could not be reached, and what ADR 0002 chose over
    // refusing outright. Nobody is signed out.
    const reply = await handleOptions(flaky, {});
    expect(reply.course).toEqual([]);
    expect(reply.emptyLevels).toContain("course");
  });

  test("an empty course list is a dead session, not a layout change", async () => {
    // The bug this exists for. A signed-out request to convention A answers HTTP
    // 200 with a well-formed payload whose <select> holds only "-Select-", so
    // every sign of life looks good and nothing throws. The app then showed a
    // signed-in dashboard with five dead dropdowns and an `emptyLevels` warning
    // blaming ECAP's markup — the one reading that is certainly wrong.
    //
    // Every account has at least one course, so an empty course list can only mean
    // the session is gone. 401 is the honest answer, and the client turns it into
    // the sign-in form with a reason.
    const { reader: noCourses } = fake({ course: [] });
    await expect(handleOptions(noCourses, {})).rejects.toThrow(
      /session expired/i
    );

    // The placeholder on its own is still an empty list, so it is the same case.
    const { reader: placeholderOnly } = fake({
      course: [opt("0", "-Select-")],
    });
    await expect(handleOptions(placeholderOnly, {})).rejects.toThrow(
      /session expired/i
    );

    // And a real course still works, so this does not simply refuse everything.
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
    // ShowAcademicCalendar needs each level by identifier AND by visible text,
    // and returns nothing at all rather than failing when the text is missing.
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
    // Refused before the portal was troubled at all.
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
    // "No classes in that date range" sends a reader to change dates that would
    // never have worked. The other cause means this app is broken, and the
    // reader needs to know which of the two they are looking at.
    const { reader } = fake({ register: "<p>nothing here</p>" });
    return expect(
      handleRegister(reader, levels({ from: "01/01/2026", to: "28/09/2026" }))
    ).rejects.toThrow(/no classes in that date range[\s\S]*layout has changed/);
  });

  test("an HttpError carries the status the route will answer with", async () => {
    const { reader } = fake({ register: "<p>nothing</p>" });
    // 502 and not 500, because the empty register is the portal's answer rather
    // than a fault in this app - and the message is one a reader can act on.
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
    // Cascade order rather than field order, so the message names the level the
    // user is actually looking for rather than an arbitrary one.
    expect(() => requireLevels({})).toThrow("Choose a course.");
    expect(() => requireLevels({ course: opt("1", "B.Tech") })).toThrow(
      "Choose a semester."
    );
    expect(() =>
      requireLevels({ course: opt("1", "B.Tech"), semester: opt("3", "III") })
    ).toThrow("Choose a branch.");
  });
});
