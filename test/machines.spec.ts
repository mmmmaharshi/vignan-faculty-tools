import { test, expect } from "@playwright/test";

import { sessionVerdict } from "../server/session-verdict";
import type { Student } from "../shared/api";
import { loadGate, loadNote } from "../web/app/load-gate";
import {
  closePanel,
  finishClose,
  isPanelOpen,
  openPanel,
} from "../web/app/panel-state";
import { nextRoute } from "../web/app/route-guard";
import { isBooted, isSignedIn } from "../web/app/session-view";
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

test.describe("explicit state machines", () => {
  test("session view: the boot check and the sign-in are one state", () => {
    expect(isBooted("booting"), "nothing asked yet").toBe(false);
    expect(isSignedIn("booting")).toBe(false);
    expect(isBooted("signedOut")).toBe(true);
    expect(isSignedIn("signedOut")).toBe(false);
    expect(isBooted("signedIn")).toBe(true);
    expect(isSignedIn("signedIn")).toBe(true);
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
      loadNote({
        optionsLoading: true,
        registerLoading: false,
        preLoading: true,
        rememberedStart: null,
        rangeEdited: "",
      })
    ).toBe("Loading options...");
  });
  test("route guard: one writer decides every redirect", () => {
    expect(nextRoute("/login", { booted: true, signedIn: true })).toBe("/home");
    expect(nextRoute("/dashboard", { booted: true, signedIn: false })).toBe(
      "/login"
    );
    expect(nextRoute("/nope", { booted: true, signedIn: true })).toBe("/home");
    expect(nextRoute("/dashboard", { booted: false, signedIn: true })).toBe(
      null
    );
  });
  test("session verdict: only a 401 evicts, a 502 stays unknown", () => {
    expect(sessionVerdict("alive", null)).toBe("alive");
    expect(sessionVerdict("dead", null)).toBe("alive");
    expect(sessionVerdict("dead", { status: 401 })).toBe("dead");
    expect(sessionVerdict("dead", { status: 502 })).toBe("unknown");
  });
});
