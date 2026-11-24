import { test, expect } from "@playwright/test";

import {
  absenceResult,
  advance,
  endAtCap,
  walking,
} from "../server/absence-walk";
import type { AbsenceStep } from "../server/absence-walk";
import { backlogStep, startCursor } from "../server/backlog-cursor";
import { classResolution, unstatedReason } from "../server/class-resolution";
import type { ClassSemester } from "../server/class-resolution";
import { endScan, scanStep, startScan } from "../server/find-scan";
import { HttpError } from "../server/http-error";
import {
  livenessGuard,
  markTouched,
  untouched,
} from "../server/liveness-guard";
import { sessionVerdict } from "../server/session-verdict";
import type {
  DayWorkCell,
  DayWorkSection,
  FindReply,
  Option,
  Student,
  TodayClass,
} from "../shared/api";
import { loadGate, loadNote } from "../web/app/load-gate";
import { createLoadSnap } from "../web/app/load-snap";
import {
  closePanel,
  finishClose,
  isPanelOpen,
  openPanel,
} from "../web/app/panel-state";
import { nextRoute } from "../web/app/route-guard";
import { endNote, keepsCredential } from "../web/app/session-end";
import {
  bootNote,
  bootStep,
  isBooted,
  isSignedIn,
} from "../web/app/session-view";
import { ApiError, clearStoredSession } from "../web/data/client";
import { FIRST_PHASE, updateStep } from "../web/data/update-lifecycle";
import {
  periodStatus,
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
import { EMPTY_OPTS, EMPTY_SEL } from "../web/register/cascade";
import { createCascadeRun } from "../web/register/cascade-run-state";
import { optionsRunKey } from "../web/register/options-chain";
import { searchResult } from "../web/register/search-result";
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
const foundClass = {
  course: { value: "1", label: "B.Tech", title: "" },
  semester: { value: "1", label: "I Semester", title: "2025" },
  branch: { value: "1", label: "IT", title: "" },
  section: { value: "1", label: "Section-1", title: "" },
  semesterInferred: true,
};
const foundReply = (over: Partial<FindReply> = {}): FindReply => ({
  profile: {
    cgpa: "",
    credits: "",
    cgpaPercent: "",
    sgpa: [],
    phones: [],
    backlogs: { rows: [], total: null, note: "" },
  },
  class: foundClass,
  window: { from: "01/07/2026", to: "31/07/2026" },
  student: student("1"),
  fullAbsent: null,
  fullRange: null,
  note: "",
  ...over,
});

const bootPhase = (hasController: boolean, hasWaiting: boolean) =>
  updateStep(FIRST_PHASE, { kind: "boot", hasController, hasWaiting });

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
  test("session end: one reason decides the note and the stored credential", () => {
    expect(endNote({ kind: "signed-out" }), "leaving is silent").toBeNull();
    expect(
      endNote({ kind: "boot", end: "signed-out" }),
      "a session that was never there is silent"
    ).toBeNull();
    expect(endNote({ kind: "expired" })?.text).toContain("expired");
    expect(endNote({ kind: "boot", end: "probe-unanswered" })?.text).toContain(
      "did not answer"
    );
    expect(
      keepsCredential({ kind: "boot", end: "probe-unanswered" }),
      "a silent probe may still hold a working session"
    ).toBe(true);
    expect(keepsCredential({ kind: "boot", end: "signed-out" })).toBe(true);
    expect(keepsCredential({ kind: "signed-out" }), "leaving drops it").toBe(
      false
    );
    expect(keepsCredential({ kind: "expired" }), "a 401 drops it").toBe(false);
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
  test("search result: idle, pending, a refusal, no class, no roll and a roll are distinct answers", () => {
    expect(searchResult(undefined, null, false).kind, "nothing asked yet").toBe(
      "idle"
    );
    const pending = searchResult(undefined, null, true);
    expect(pending.kind, "an ask is in flight").toBe("pending");
    expect(pending.student, "no row has arrived yet").toBeNull();
    expect(
      searchResult(undefined, foundReply(), true).kind,
      "a new ask owns the screen before the old answer"
    ).toBe("pending");
    const refused = searchResult(
      new ApiError(502, "ECAP is down"),
      null,
      false
    );
    expect(refused.kind).toBe("refused");
    expect(refused.note?.text).toBe("ECAP is down");
    expect(
      searchResult(new ApiError(401, "expired"), null, false).note,
      "a 401 is already said by the sign-out sweep"
    ).toBeNull();

    const noClass = searchResult(
      undefined,
      foundReply({ class: null, note: "No class stated" }),
      false
    );
    expect(noClass.kind).toBe("no-class");
    expect(noClass.note?.text).toBe("No class stated");
    expect(noClass.scope, "no class, nothing to scope").toBeUndefined();
    expect(noClass.profile, "the profile is still an answer").not.toBeNull();

    const noRoll = searchResult(
      undefined,
      foundReply({ student: null, note: "No row for 99Z" }),
      false
    );
    expect(noRoll.kind).toBe("no-roll");
    expect(noRoll.student).toBeNull();
    expect(noRoll.scope, "the class still names the window").toBeDefined();
    expect(noRoll.note?.text).toBe("No row for 99Z");

    const foundOne = searchResult(undefined, foundReply(), false);
    expect(foundOne.kind).toBe("found");
    expect(foundOne.student?.roll).toBe("1");
    expect(foundOne.note, "no reason to say anything").toBeNull();
  });
  test("cascade run: the four states are one lifecycle", () => {
    const run = createCascadeRun();
    const first = run.start();
    expect(run.owns(first)).toBe(true);

    const second = run.start();
    expect(
      first.aborted,
      "a superseded run asks the Portal nothing further"
    ).toBe(true);
    expect(run.owns(first)).toBe(false);
    expect(run.owns(second)).toBe(true);

    run.supersede();
    expect(second.aborted).toBe(true);
    expect(run.owns(second)).toBe(false);

    const third = run.start();
    const partial = { sel: EMPTY_SEL, opts: EMPTY_OPTS };
    expect(
      run.keepPartial(third, partial),
      "a failed run keeps what arrived"
    ).toBe(partial);
    expect(run.owns(third), "a failed run no longer owns the screen").toBe(
      false
    );

    const fourth = run.start();
    expect(run.owns(fourth)).toBe(true);
    expect(run.finish(fourth)).toBe(true);
    expect(run.owns(fourth), "a finished run released the screen").toBe(false);
    expect(run.finish(fourth), "a finished run cannot finish again").toBe(
      false
    );
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
  test("load snap: a real load arms it, an edit disarms it, and the snap fires once", () => {
    const snap = createLoadSnap();
    expect(snap.consume(), "no load yet").toBe(false);
    snap.arm();
    expect(snap.consume(), "the register answer snaps From once").toBe(true);
    expect(snap.consume(), "a second effect run cannot snap again").toBe(false);
    snap.arm();
    snap.disarm();
    expect(snap.consume(), "a hand-typed From survives the load").toBe(false);
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
  test("the options run key belongs to one session generation", () => {
    const before = optionsRunKey();
    clearStoredSession();
    expect(
      optionsRunKey(),
      "a run still in flight at Sign-out cannot answer the next session"
    ).not.toBe(before);
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
    expect(todayPhase({ classes: null, note: null })).toEqual({
      kind: "unread",
    });
    expect(todayPhase({ classes: null, note: refusal })).toEqual({
      kind: "failed",
    });
    expect(todayPhase({ classes: [], note: null })).toEqual({
      kind: "cleared",
      classes: [],
    });
    const day = [todayClass("Period 1")];
    expect(todayPhase({ classes: day, note: null })).toEqual({
      kind: "day",
      classes: day,
    });
  });
  test("postings: loader, a refusal, no classes and the grid are one phase", () => {
    expect(postingsPhase({ sections: null, note: null })).toEqual({
      kind: "loading",
    });
    expect(postingsPhase({ sections: null, note: refusal })).toEqual({
      kind: "failed",
    });
    expect(postingsPhase({ sections: [], note: null })).toEqual({
      kind: "none",
    });
    const sections = [workSection("CSE")];
    expect(postingsPhase({ sections, note: null })).toEqual({
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
    const branches = reportBranches(sections);
    expect(branches).toEqual(["CSE", "IT"]);
    expect(shownBranch(branches, null)).toBe("CSE");
    expect(shownBranch(branches, "IT")).toBe("IT");
    expect(shownBranch(branches, "gone")).toBe("CSE");
    expect(shownBranch([], null)).toBeNull();
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
  test("a period the report does not state is no class, not a missing posting", () => {
    // The box and the detail it opens must agree: a free period is grey for a
    // reason, not an unposted class the faculty should chase.
    expect(periodStatus([], "2")).toBe("no-class");
    expect(periodStatus([workCell(true)], "1")).toBe("posted");
    expect(periodStatus([workCell(false)], "1")).toBe("not-posted");
  });
  test("absence walk: a request that will not parse states nothing", () => {
    expect(absenceResult({ kind: "unparseable" }, "31/10/2026")).toEqual({
      absent: null,
      range: null,
      note: "",
    });
  });
  test("absence walk: a refusal keeps what the walk read and says so", () => {
    const read: AbsenceStep = {
      kind: "read",
      start: "02/09/2026",
      days: ["03/09", "04/09"],
    };
    const refused = advance(advance(walking, read), { kind: "refused" });
    expect(absenceResult(refused, "31/10/2026")).toEqual({
      absent: ["03/09", "04/09"],
      range: { from: "02/09/2026", to: "31/10/2026" },
      note: "ECAP would not give every month's absent days, so the full-semester list below may be incomplete.",
    });
  });
  test("absence walk: a refusal before any month has no list", () => {
    expect(
      absenceResult(advance(walking, { kind: "refused" }), "31/10/2026")
    ).toEqual({
      absent: null,
      range: null,
      note: "ECAP would not give every month's absent days, so the full-semester list below may be incomplete.",
    });
  });
  test("absence walk: a dateless month stops early without a warning", () => {
    const read: AbsenceStep = {
      kind: "read",
      start: "02/09/2026",
      days: ["03/09"],
    };
    const stopped = advance(advance(walking, read), { kind: "dateless" });
    expect(absenceResult(stopped, "31/10/2026")).toEqual({
      absent: ["03/09"],
      range: { from: "02/09/2026", to: "31/10/2026" },
      note: "",
    });
  });
  test("absence walk: reaching the cap is a warning, not a refusal", () => {
    const read: AbsenceStep = {
      kind: "read",
      start: "01/07/2026",
      days: ["05/07"],
    };
    expect(
      absenceResult(endAtCap(advance(walking, read)), "31/10/2026")
    ).toEqual({
      absent: ["05/07"],
      range: { from: "01/07/2026", to: "31/10/2026" },
      note: "ECAP kept stating meeting days twelve months back, so the semester may have started earlier than shown.",
    });
  });
  test("absence walk: months collect oldest first and the range opens at the oldest", () => {
    let walk = advance(walking, {
      kind: "read",
      start: "02/09/2026",
      days: ["03/09"],
    } satisfies AbsenceStep);
    walk = advance(walk, {
      kind: "read",
      start: "01/08/2026",
      days: ["02/08"],
    } satisfies AbsenceStep);
    const answer = absenceResult(endAtCap(walk), "30/09/2026");
    expect(answer.absent).toEqual(["02/08", "03/09"]);
    expect(answer.range).toEqual({ from: "01/08/2026", to: "30/09/2026" });
  });
  test("section scan: finding the roll ends the scan with its section", () => {
    const s1: Option = { value: "A", label: "A", title: "" };
    const s2: Option = { value: "B", label: "B", title: "" };
    let scan = scanStep(startScan<Student>(), {
      kind: "answered",
      section: s1,
      row: null,
    });
    scan = scanStep(scan, {
      kind: "answered",
      section: s2,
      row: student("21CS001"),
    });
    expect(endScan(scan)).toEqual({
      kind: "found",
      section: s2,
      row: student("21CS001"),
    });
  });
  test("section scan: no section answering and no refusal is unanswered", () => {
    expect(endScan(startScan())).toEqual({ kind: "unanswered" });
  });
  test("section scan: an answered section without the roll is a no-row", () => {
    const scan = scanStep(startScan<Student>(), {
      kind: "answered",
      section: { value: "A", label: "A", title: "" },
      row: null,
    });
    expect(endScan(scan)).toEqual({ kind: "no-row" });
  });
  test("section scan: only a scan with no answer at all can be refused", () => {
    const error = new HttpError(502, "bad shape");
    expect(
      endScan(scanStep(startScan<Student>(), { kind: "refused", error }))
    ).toEqual({ kind: "refused", error });
    const answered = scanStep(startScan<Student>(), {
      kind: "answered",
      section: { value: "A", label: "A", title: "" },
      row: null,
    });
    expect(endScan(scanStep(answered, { kind: "refused", error }))).toEqual({
      kind: "no-row",
    });
  });
  test("section scan: the first refusal is the one reported", () => {
    const first = new HttpError(502, "first");
    const second = new HttpError(502, "second");
    let scan = scanStep(startScan<Student>(), {
      kind: "refused",
      error: first,
    });
    scan = scanStep(scan, { kind: "refused", error: second });
    expect(endScan(scan)).toEqual({ kind: "refused", error: first });
  });
  test("class resolution: a stated semester is not marked inferred", () => {
    const course: Option = { value: "1", label: "B.Tech", title: "" };
    const branch: Option = { value: "2", label: "IT", title: "" };
    const semester: ClassSemester = {
      kind: "stated",
      option: { value: "3", label: "III Semester", title: "2025" },
    };
    const sections: Array<Option> = [{ value: "A", label: "A", title: "" }];
    expect(
      classResolution({
        course,
        branch,
        semester,
        sections,
        noSectionsReason: "none",
      })
    ).toEqual({
      kind: "resolved",
      value: {
        levels: { course, branch, semester: semester.option },
        sections,
        label: "B.Tech · III Semester · IT",
        semesterInferred: false,
      },
    });
  });
  test("class resolution: the inferred flag comes from the inferred branch", () => {
    const semester: ClassSemester = {
      kind: "inferred",
      option: { value: "3", label: "III Semester", title: "2025" },
    };
    const resolved = classResolution({
      course: { value: "1", label: "B.Tech", title: "" },
      branch: { value: "2", label: "IT", title: "" },
      semester,
      sections: [{ value: "A", label: "A", title: "" }],
      noSectionsReason: "none",
    });
    expect(
      resolved.kind === "resolved" && resolved.value.semesterInferred
    ).toBe(true);
  });
  test("class resolution: no sections is an unstated outcome with the reason", () => {
    expect(
      classResolution({
        course: { value: "1", label: "B.Tech", title: "" },
        branch: { value: "2", label: "IT", title: "" },
        semester: {
          kind: "stated",
          option: { value: "3", label: "III Semester", title: "2025" },
        },
        sections: [],
        noSectionsReason: "no sections offered",
      })
    ).toEqual({ kind: "unstated", reason: "no sections offered" });
  });
  test("class resolution: the reason names what the page did or did not state", () => {
    expect(unstatedReason("course", "B.Tech")).toContain('"B.Tech"');
    expect(unstatedReason("course", "")).toContain("does not state a course");
  });
  test("liveness guard: only a call that touched ECAP may answer unprobed", () => {
    expect(livenessGuard(untouched)).toEqual({ kind: "probe" });
    expect(livenessGuard(markTouched())).toEqual({ kind: "answer" });
  });
  test("backlog cursor: a semester header opens its subject row", () => {
    expect(backlogStep(startCursor, "I Semester")).toEqual({
      kind: "open-row",
      cursor: { kind: "awaiting-subjects" },
    });
  });
  test("backlog cursor: a subject cell fills only the open row", () => {
    const open = { kind: "awaiting-subjects" } as const;
    expect(backlogStep(startCursor, "II Semester")).toEqual({
      kind: "open-row",
      cursor: open,
    });
    expect(backlogStep(open, "MA101")).toEqual({
      kind: "fill-subjects",
      cursor: { kind: "awaiting-semester" },
    });
    expect(backlogStep(startCursor, "MA101")).toEqual({
      kind: "ignore",
      cursor: startCursor,
    });
  });
  test("backlog cursor: the page's total ends the table with its count", () => {
    expect(backlogStep(startCursor, "Total backlogs: 3")).toEqual({
      kind: "stop",
      total: 3,
    });
  });
  test("installed update: both paths reach one offer, and only a yes reloads", () => {
    // A shell that finished while the page was open: offered at once.
    expect(bootPhase(true, true)).toEqual({
      phase: "installed-waiting",
      action: "offer",
    });
    // A first install has no old shell: silent, but it still listens.
    expect(bootPhase(false, true)).toEqual({
      phase: "first-install",
      action: "listen",
    });
    // A return visit with no waiting shell watches for a download.
    expect(bootPhase(true, false)).toEqual({
      phase: "downloading",
      action: "listen",
    });
    // A download found during the visit: watch the installing worker.
    expect(updateStep("downloading", { kind: "updatefound" })).toEqual({
      phase: "downloading",
      action: "watch",
    });
    // A second worker found after a decline cannot take the offer away, and
    // one found after a yes cannot restart an update already applying.
    expect(updateStep("installed-waiting", { kind: "updatefound" })).toEqual({
      phase: "installed-waiting",
      action: "none",
    });
    expect(updateStep("updating", { kind: "updatefound" })).toEqual({
      phase: "updating",
      action: "none",
    });
    // A worker in any other state decides nothing.
    expect(
      updateStep("downloading", {
        kind: "worker-state",
        state: "activating",
        hasController: true,
      })
    ).toEqual({ phase: "downloading", action: "none" });
    // A worker reporting in after the offer stands, or after a yes, must not
    // ask a second question: only the worker being watched may offer.
    expect(
      updateStep("installed-waiting", {
        kind: "worker-state",
        state: "installed",
        hasController: true,
      })
    ).toEqual({ phase: "installed-waiting", action: "none" });
    expect(
      updateStep("updating", {
        kind: "worker-state",
        state: "installed",
        hasController: true,
      })
    ).toEqual({ phase: "updating", action: "none" });
    // The downloading path reaches the same offer as the waiting path.
    expect(
      updateStep("downloading", {
        kind: "worker-state",
        state: "installed",
        hasController: true,
      })
    ).toEqual({ phase: "installed-waiting", action: "offer" });
    // ...unless there is no old shell to update from.
    expect(
      updateStep("downloading", {
        kind: "worker-state",
        state: "installed",
        hasController: false,
      })
    ).toEqual({ phase: "first-install", action: "none" });
    // Only a yes from the installed-and-waiting phase reloads.
    expect(
      updateStep("installed-waiting", { kind: "answered", confirmed: true })
    ).toEqual({ phase: "updating", action: "apply" });
    expect(
      updateStep("installed-waiting", { kind: "answered", confirmed: false })
    ).toEqual({ phase: "installed-waiting", action: "none" });
    // An answer outside the offer phase cannot reload.
    expect(
      updateStep("downloading", { kind: "answered", confirmed: true })
    ).toEqual({ phase: "downloading", action: "none" });
  });
});
