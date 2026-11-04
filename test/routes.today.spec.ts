import { expect, test } from "@playwright/test";

import { HttpError } from "../server/portal-replies";
import {
  handleRegister,
  handleStudentProfile,
  handleTodayClasses,
  handleUnposted,
} from "../server/server-routes";
import type { PortalReader } from "../server/server-routes";
import { ALL_SUBJECTS } from "../shared/api";
import type { RegisterReply, StudentProfile } from "../shared/api";
import {
  DAYWORK,
  bothStarted,
  cseBranch,
  fake,
  itBranch,
  levels,
  nth,
  opt,
  startedPair,
  titledSemesters,
} from "./support/routes-fake";

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

test.describe("independent portal reads go out together", () => {
  test("a subject register reads its grid and its overall column together", async () => {
    const { reader } = fake();
    const { started, loaded, release } = startedPair(reader, (held) =>
      handleRegister(held, levels({ from: "01/01/2026", to: "28/09/2026" }))
    );
    bothStarted(started, "register", "class");
    release();
    const reply = (await loaded) as RegisterReply;
    expect(reply.students).toHaveLength(1);
  });
  test("an all-subjects load reads the report and the subject listing together", async () => {
    const { reader } = fake();
    const { started, loaded, release } = startedPair(reader, (held) =>
      handleRegister(held, levels({ subject: ALL_SUBJECTS }))
    );
    bothStarted(started, "class", "offered");
    release();
    const reply = (await loaded) as RegisterReply;
    expect(reply.summary.subjectColumns).toEqual(["AI"]);
  });
  test("a student panel reads the profile page and the absent grid together", async () => {
    const { reader } = fake();
    const { started, loaded, release } = startedPair(reader, (held) =>
      handleStudentProfile(held, {
        roll: "21CS001",
        name: "A Student",
        register: levels({ subject: ALL_SUBJECTS }),
      })
    );
    bothStarted(started, "profile", "wise");
    release();
    const reply = (await loaded) as StudentProfile;
    expect(reply.cgpa).toBe("5.61");
  });
});
