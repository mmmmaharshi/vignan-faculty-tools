import { test, expect } from "@playwright/test";

import { HttpError } from "../server/http-error";
import { sessionVerdict } from "../server/session-verdict";
import type {
  DayWorkCell,
  DayWorkSection,
  Student,
  TodayClass,
} from "../shared/api";
import { loadGate, loadNote } from "../web/app/load-gate";
import {
  closePanel,
  finishClose,
  isPanelOpen,
  openPanel,
} from "../web/app/panel-state";
import { nextRoute } from "../web/app/route-guard";
import {
  bootNote,
  bootStep,
  isBooted,
  isSignedIn,
} from "../web/app/session-view";
import {
  postingsPhase,
  reportBranches,
  shownBranch,
  slotStatus,
  SLOT_STATUS_LABEL,
} from "../web/home/postings-phase";
import { todayPhase } from "../web/home/today-phase";
import {
  fullAbsenceList,
  windowAbsenceList,
} from "../web/register/absence-list";
import { searchScope } from "../web/register/search-scope";

const student = (roll: string): Student => ({
  sl: "1",
  roll,
  name: "A Student",
  attendedOfHeld: "",
  pct: 80,
  irregular: false,
  critical: false,
  overallAttendedOfHeld: "",
  overallPct: 80,
  overallIrregular: false,
  overallCritical: false,
  subjects: [],
  absent: [],
});

const todayClass = (period: string): TodayClass => ({
  period,
  time: "08:45 AM- 09:35 AM",
  subject: "AI",
  section: "3 IT-C",
  room: "",
});
const workCell = (posted: boolean): DayWorkCell => ({
  period: "1",
  subject: "MFCS",
  posted,
  staff: "A Faculty",
  present: "30",
  absent: "5",
  absentRolls: ["21B"],
});
const workSection = (branch: string): DayWorkSection => ({
  branch,
  branchShort: branch,
  semester: "III Semester",
  section: "B",
  cells: [workCell(true)],
});
const refusal = { kind: "error" as const, text: "down" };

const bootFrom = (over: Partial<Parameters<typeof bootStep>[0]>) =>
  bootStep({
    booted: false,
    loading: false,
    data: undefined,
    retried: false,
    ...over,
  });

test.describe("explicit state machines", () => {
  test("session view: the boot check and the sign-in are one state", () => {
    expect(isBooted("booting"), "nothing asked yet").toBe(false);
    expect(isSignedIn("booting")).toBe(false);
    expect(isBooted("signedOut")).toBe(true);
    expect(isSignedIn("signedOut")).toBe(false);
    expect(isBooted("signedIn")).toBe(true);
    expect(isSignedIn("signedIn")).toBe(true);
  });
  test("boot: the probe's answers are one transition table", () => {
    expect(
      bootFrom({ loading: true }),
      "a probe in flight decides nothing"
    ).toEqual({ kind: "wait" });
    expect(bootFrom({ booted: true }), "the boot runs once").toEqual({
      kind: "wait",
    });
    expect(bootFrom({}), "an unanswered probe gets one retry").toEqual({
      kind: "retry",
    });
    expect(
      bootFrom({ retried: true }),
      "a second silence ends the boot with a reason"
    ).toEqual({ kind: "signOut", end: "probe-unanswered" });
    expect(
      bootFrom({ data: { signedIn: false, userId: "" } }),
      "an absent session is a quiet end"
    ).toEqual({ kind: "signOut", end: "signed-out" });
    expect(
      bootFrom({ data: { signedIn: true, userId: " faculty " } }),
      "the session's own name travels with the answer"
    ).toEqual({ kind: "signIn", userId: " faculty " });
  });
  test("boot: only a probe that never answered puts a note on the form", () => {
    expect(bootNote("probe-unanswered")?.text).toContain("did not answer");
    expect(bootNote("signed-out")).toBeNull();
  });
  test("the panel shows one absent list, and never a window passed off as the semester", () => {
    const window = ["02/09"];
    // The wider read answered: it is the one list, window dates and all.
    expect(
      fullAbsenceList({
        wider: ["02/09", "15/07"],
        semesterStart: "01/07/2026",
        windowStartsAfterStart: true,
        window,
      })
    ).toEqual(["02/09", "15/07"]);
    // No wider read, the window is the whole semester: its dates stand.
    expect(
      fullAbsenceList({
        wider: undefined,
        semesterStart: "01/09/2026",
        windowStartsAfterStart: false,
        window,
      })
    ).toEqual(window);
    // No wider read and the window starts after the semester: nothing is
    // claimed, because those dates are not the semester's.
    expect(
      fullAbsenceList({
        wider: undefined,
        semesterStart: "01/07/2026",
        windowStartsAfterStart: true,
        window,
      })
    ).toBeNull();
    // No start known: nothing is claimed either.
    expect(
      fullAbsenceList({
        wider: undefined,
        semesterStart: null,
        windowStartsAfterStart: false,
        window,
      })
    ).toBeNull();
    // The window's own list prefers the register row's cells when it has any,
    // then the panel's own read.
    expect(
      windowAbsenceList({ ...student("1"), absent: ["05/09"] }, ["03/09"])
    ).toEqual(["05/09"]);
    expect(windowAbsenceList(student("1"), ["03/09"])).toEqual(["03/09"]);
    expect(windowAbsenceList(null, ["03/09"])).toEqual(["03/09"]);
    expect(windowAbsenceList(null, undefined)).toEqual([]);
  });
  test("a searched figure carries the class and window it belongs to", () => {
    expect(searchScope(null), "no class, nothing to scope").toBeUndefined();
    const scope = searchScope({
      profile: {
        cgpa: "",
        credits: "",
        cgpaPercent: "",
        sgpa: [],
        phones: [],
        backlogs: { rows: [], total: null, note: "" },
      },
      class: {
        course: { value: "1", label: "B.Tech", title: "" },
        semester: { value: "1", label: "I Semester", title: "2025" },
        branch: { value: "1", label: "IT", title: "" },
        section: null,
        semesterInferred: true,
      },
      window: { from: "01/07/2026", to: "31/07/2026" },
      student: null,
      fullAbsent: null,
      fullRange: null,
      note: "",
    });
    expect(scope, "an inferred semester says so").toContainEqual({
      label: "Semester",
      value: "I Semester (inferred)",
    });
    expect(scope, "the window travels with the figure").toContainEqual({
      label: "Window",
      value: "01/07/2026 to 31/07/2026",
    });
    expect(
      scope?.some((row) => row.label === "Section"),
      "a class with no section states no section row"
    ).toBe(false);
  });
  test("panel: open survives close until the slide-out finishes", () => {
    const opened = openPanel(student("1"));
    expect(isPanelOpen(opened)).toBe(true);
    const closing = closePanel(opened);
    expect(isPanelOpen(closing)).toBe(false);
    expect(closing.student?.roll).toBe("1");
    expect(finishClose(closing).status).toBe("closed");
  });
  test("panel: closing an already-closed panel stays closed", () => {
    expect(closePanel({ status: "closed", student: null }).status).toBe(
      "closed"
    );
  });
  test("load gate: a typed To alone still waits for the start probe", () => {
    expect(
      loadGate({
        optionsLoading: false,
        registerLoading: false,
        preLoading: true,
        rememberedStart: null,
        rangeEdited: "to",
      })
    ).toBe("finding-start");
  });
  test("load gate: unremembered walk still waits until From is typed", () => {
    expect(
      loadGate({
        optionsLoading: false,
        registerLoading: false,
        preLoading: true,
        rememberedStart: null,
        rangeEdited: "",
      })
    ).toBe("finding-start");
    expect(
      loadGate({
        optionsLoading: false,
        registerLoading: false,
        preLoading: true,
        rememberedStart: null,
        rangeEdited: "from",
      })
    ).toBe("ready");
  });
  test("load gate: options and register beat the start probe in the note", () => {
    expect(
      loadNote(
        loadGate({
          optionsLoading: true,
          registerLoading: false,
          preLoading: true,
          rememberedStart: null,
          rangeEdited: "",
        })
      )
    ).toBe("Loading options...");
  });
  test("route guard: one writer decides every redirect", () => {
    expect(nextRoute("/login", "signedIn")).toBe("/home");
    expect(nextRoute("/dashboard", "signedOut")).toBe("/login");
    expect(nextRoute("/nope", "signedIn")).toBe("/home");
    expect(nextRoute("/dashboard", "booting")).toBe(null);
  });
  test("session verdict: only a 401 evicts, a 502 stays unknown", () => {
    expect(sessionVerdict("alive", null)).toBe("alive");
    expect(sessionVerdict("dead", null)).toBe("alive");
    // The verdict narrows the failure itself, so a refusal is the only thing
    // that can mean the credential is gone.
    expect(sessionVerdict("dead", new HttpError(401, "expired"))).toBe("dead");
    expect(sessionVerdict("dead", new HttpError(502, "down"))).toBe("unknown");
    expect(sessionVerdict("dead", new Error("socket"))).toBe("unknown");
  });
  test("timetable: unread, a refusal, a cleared evening and a day are one phase", () => {
    expect(todayPhase({ classes: null, busy: true, note: null })).toEqual({
      kind: "unread",
    });
    expect(todayPhase({ classes: null, busy: false, note: refusal })).toEqual({
      kind: "failed",
    });
    expect(todayPhase({ classes: [], busy: false, note: null })).toEqual({
      kind: "cleared",
      classes: [],
    });
    const day = [todayClass("Period 1")];
    expect(todayPhase({ classes: day, busy: false, note: null })).toEqual({
      kind: "day",
      classes: day,
    });
  });
  test("postings: loader, a refusal, no classes and the grid are one phase", () => {
    expect(postingsPhase({ sections: null, busy: true, note: null })).toEqual({
      kind: "loading",
    });
    expect(
      postingsPhase({ sections: null, busy: false, note: refusal })
    ).toEqual({ kind: "failed" });
    expect(postingsPhase({ sections: [], busy: false, note: null })).toEqual({
      kind: "none",
    });
    const sections = [workSection("CSE")];
    expect(postingsPhase({ sections, busy: false, note: null })).toEqual({
      kind: "report",
      sections,
    });
  });
  test("postings: the branch on show is always one the report named", () => {
    const sections = [
      workSection("CSE"),
      workSection("IT"),
      workSection("CSE"),
    ];
    expect(reportBranches(sections)).toEqual(["CSE", "IT"]);
    expect(shownBranch(sections, null)).toBe("CSE");
    expect(shownBranch(sections, "IT")).toBe("IT");
    expect(shownBranch(sections, "gone")).toBe("CSE");
    expect(shownBranch(null, null)).toBeNull();
  });
  test("a period box's detail is one typed status, never a plain string", () => {
    expect(slotStatus(null)).toBe("no-class");
    expect(slotStatus(workCell(true))).toBe("posted");
    expect(slotStatus(workCell(false))).toBe("not-posted");
    expect(SLOT_STATUS_LABEL[slotStatus(null)]).toBe("No class stated");
    expect(SLOT_STATUS_LABEL[slotStatus(workCell(true))]).toBe("Posted");
    expect(SLOT_STATUS_LABEL[slotStatus(workCell(false))]).toBe(
      "Not posted yet"
    );
  });
});
