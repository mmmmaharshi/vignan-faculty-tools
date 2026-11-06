import { expect, test } from "@playwright/test";

import { ALL_SUBJECTS } from "../shared/api";
import type { OptionsRequest } from "../shared/api";
import { ApiError } from "../web/data/client";
import { selectionAfter, subjectNameKey } from "../web/register/cascade";
import type { Sel } from "../web/register/cascade";
import { partialOf, runCascade } from "../web/register/cascade-run";
import {
  courseOnlyReply,
  fullReply,
  nothing,
  opt,
  reply,
  sel,
} from "./support/cascade-harness";

test.describe("the cascade's option loop", () => {
  const SETTLED: Sel = {
    course: "1",
    semester: "3",
    branch: "4",
    section: "5",
    subject: "6",
  };
  test("a manual section change clears the subject, and a saved class keeps its own", () => {
    const full = sel(SETTLED);
    expect(
      selectionAfter(full, "section"),
      "made by hand, so nothing below it survives"
    ).toEqual({ ...SETTLED, subject: "" });
    expect(
      selectionAfter(full, "section", full),
      "arrived whole, so it keeps the subject it names"
    ).toEqual(full);
  });
  test("a run keeps asking while a level below a chosen one is still empty", async () => {
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(), known: nothing },
      (request) => {
        runs.push(request);
        const pass = runs.length;
        const fill = (level: number, value: string) =>
          pass >= level ? [value] : [];
        return Promise.resolve(
          reply({
            course: fill(1, "1"),
            semester: fill(2, "3"),
            branch: fill(3, "4"),
            section: fill(4, "5"),
            subject: fill(5, "6"),
          })
        );
      }
    );
    expect(
      runs.length,
      "one pass per level, each asked for by the pass before it"
    ).toBe(5);
    expect(outcome?.sel).toEqual(SETTLED);
  });
  test("a selection that is already settled is one request", async () => {
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      (request) => {
        runs.push(request);
        return Promise.resolve(fullReply());
      }
    );
    expect(runs.length, "nothing is gained, so nothing more is asked").toBe(1);
    expect(outcome?.sel).toEqual(SETTLED);
  });
  test("a pass that stumbles is asked again once, then settles", async () => {
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      (request) => {
        runs.push(request);
        if (runs.length === 1) {
          throw new ApiError(502, "ECAP stumbled");
        }
        return Promise.resolve(fullReply());
      }
    );
    expect(
      runs.length,
      "the failed pass is re-asked, not the run restarted"
    ).toBe(2);
    expect(outcome?.sel).toEqual(SETTLED);
  });
  test("a run that fails after settling carries what arrived, on the error", async () => {
    const runs: OptionsRequest[] = [];
    const failure = await runCascade(
      { seed: sel(), known: nothing },
      // Async so the settled reply needs no Promise.resolve wrapper; the
      // await is the tick that keeps it that way.
      async (request) => {
        runs.push(request);
        await Promise.resolve();
        if (runs.length > 1) {
          throw new ApiError(502, "ECAP stumbled");
        }
        return courseOnlyReply();
      }
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    const partial = partialOf(failure);
    expect(
      partial?.sel.course,
      "the course that arrived stays chosen beside the error"
    ).toBe("1");
    expect(partial?.opts.course.map((o) => o.value)).toEqual(["1"]);
  });
  test("a pass that keeps stumbling fails the run after its retry", async () => {
    const runs: OptionsRequest[] = [];
    const failure = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      (request) => {
        runs.push(request);
        throw new ApiError(502, "ECAP stumbled");
      }
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(runs.length, "one retry per pass, never a loop").toBe(2);
  });
  test("a refused session is answered, never re-asked", async () => {
    const runs: OptionsRequest[] = [];
    const failure = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      (request) => {
        runs.push(request);
        throw new ApiError(401, "session expired");
      }
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(runs.length, "the 401 must reach the sign-out sweep at once").toBe(
      1
    );
  });
  test("a judged 4xx is answered, never re-asked", async () => {
    const runs: OptionsRequest[] = [];
    const failure = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      (request) => {
        runs.push(request);
        throw new ApiError(400, "choose a course");
      }
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(runs.length, "re-asking a judged request cannot change it").toBe(1);
  });
  test("a run that starts with a semester chosen sends its title as the batch", async () => {
    const runs: OptionsRequest[] = [];
    const known = reply({
      course: ["1"],
      semester: [],
      branch: [],
      section: [],
      subject: [],
    });
    known.semester = [opt("3", "III Semester", "2025")];
    await runCascade(
      { seed: sel({ course: "1", semester: "3" }), known },
      (request) => {
        runs.push(request);
        return Promise.resolve(fullReply());
      }
    );
    expect(
      runs[0]?.semesterTitle,
      "the Portal wants the batch number beside the semester's value"
    ).toBe("2025");
  });
  test("a run keeps every subject name it was offered, but not the whole-section entry", async () => {
    const outcome = await runCascade(
      { seed: sel(SETTLED), known: nothing },
      () => {
        const one = fullReply();
        one.subject = [ALL_SUBJECTS, opt("6", "DATA STRUCTURES")];
        return Promise.resolve(one);
      }
    );
    expect(outcome?.names.get(subjectNameKey("5", "6"))).toBe(
      "DATA STRUCTURES"
    );
    expect(
      outcome?.names.has(subjectNameKey("5", ALL_SUBJECTS.value)),
      "All subjects is a way of asking, not a subject"
    ).toBe(false);
  });
  test("a run superseded while the Portal is being asked stops there and answers nothing", async () => {
    const controller = new AbortController();
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(SETTLED), known: nothing, signal: controller.signal },
      (request) => {
        runs.push(request);
        // A newer change landed while this one was in flight. This pass settles
        // the chain, so nothing more would be asked even without the check — but
        // the answer is the one before the newer change, and the screen must not
        // take it.
        controller.abort();
        return Promise.resolve(fullReply());
      }
    );
    expect(outcome, "a superseded run must not write to the screen").toBeNull();
    expect(runs.length).toBe(1);
  });
  test("a run superseded on a pass that had more to do asks no further", async () => {
    const controller = new AbortController();
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(), known: nothing, signal: controller.signal },
      (request) => {
        runs.push(request);
        controller.abort();
        return Promise.resolve(
          reply({
            course: ["1"],
            semester: [],
            branch: [],
            section: [],
            subject: [],
          })
        );
      }
    );
    expect(outcome).toBeNull();
    expect(runs.length, "and must not keep asking the Portal").toBe(1);
  });
  test("a run that is already superseded asks the Portal nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const runs: OptionsRequest[] = [];
    const outcome = await runCascade(
      { seed: sel(), known: nothing, signal: controller.signal },
      (request) => {
        runs.push(request);
        return Promise.resolve(fullReply());
      }
    );
    expect(outcome).toBeNull();
    expect(runs.length, "not even once").toBe(0);
  });
});
