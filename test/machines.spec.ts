import { test, expect } from "@playwright/test";

import { sessionVerdict } from "../server/session-verdict";
import type { Student } from "../shared/api";
import { loadGate, loadNote } from "../web/load-gate";
import {
  closePanel,
  finishClose,
  isPanelOpen,
  openPanel,
} from "../web/panel-state";
import { nextRoute } from "../web/route-guard";

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
