import { expect, test } from "@playwright/test";
import {
  array,
  assert,
  boolean,
  constant,
  constantFrom,
  nat,
  oneof,
  property,
  record,
  string,
} from "fast-check";

import type { FindReply, Student } from "../shared/api";
import { loadGate } from "../web/app/load-gate";
import { createLoadSnap } from "../web/app/load-snap";
import {
  CLOSED_PANEL,
  closePanel,
  finishClose,
  isPanelOpen,
  openPanel,
} from "../web/app/panel-state";
import { DASHBOARD_PATH, HOME_PATH, LOGIN_PATH } from "../web/app/paths";
import { nextRoute } from "../web/app/route-guard";
import { endNote, keepsCredential } from "../web/app/session-end";
import type { SessionEnd } from "../web/app/session-end";
import { bootStep, isBooted, isSignedIn } from "../web/app/session-view";
import { ApiError } from "../web/data/client";
import { createEpoch } from "../web/data/session-epoch";
import { FIRST_PHASE, updateStep } from "../web/data/update-lifecycle";
import type { UpdateEvent, UpdatePhase } from "../web/data/update-lifecycle";
import { EMPTY_OPTS, EMPTY_SEL } from "../web/register/cascade";
import { createCascadeRun } from "../web/register/cascade-run-state";
import { searchResult } from "../web/register/search-result";

/**
 * Properties over the app's own state, not examples of it.
 *
 * Each of these is a rule that must hold for *every* input or *every*
 * sequence, which is what the hand-written tests cannot say: an example proves
 * one path through a guard, a property proves there is no path out of it.
 */
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

const searched = (hasClass: boolean, hasRoll: boolean): FindReply => ({
  profile: {
    cgpa: "",
    credits: "",
    cgpaPercent: "",
    sgpa: [],
    phones: [],
    backlogs: { rows: [], total: null, note: "" },
  },
  class: hasClass
    ? {
        course: { value: "1", label: "B.Tech", title: "" },
        semester: { value: "1", label: "I Semester", title: "2025" },
        branch: { value: "1", label: "IT", title: "" },
        section: null,
        semesterInferred: true,
      }
    : null,
  window: { from: "01/07/2026", to: "31/07/2026" },
  student: hasRoll ? student("1") : null,
  fullAbsent: null,
  fullRange: null,
  note: "",
});

test.describe("the redirect guard converges", () => {
  test("every path settles in at most two hops", () => {
    // The redirect loop was 37 navigations in six seconds. The property is
    // convergence: follow nextRoute until it stops moving, and it must stop.
    assert(
      property(
        oneof(
          constantFrom(
            "/",
            LOGIN_PATH,
            HOME_PATH,
            DASHBOARD_PATH,
            "/profile",
            "/search",
            "/nope",
            ""
          ),
          string({ maxLength: 24 })
        ),
        constantFrom("booting", "signedOut", "signedIn"),
        (pathname, view) => {
          let current = pathname;
          let hops = 0;
          for (; hops < 5; hops++) {
            const next = nextRoute(current, view);
            if (next === null || next === current) return hops <= 2;
            current = next;
          }
          return false;
        }
      ),
      { numRuns: 300 }
    );
  });
  test("a signed-in visitor is never sent to the login form", () => {
    assert(
      property(string(), (pathname) => {
        const next = nextRoute(pathname, "signedIn");
        return next !== LOGIN_PATH;
      }),
      { numRuns: 200 }
    );
  });
  test("a signed-out visitor is never kept off the login form", () => {
    assert(
      property(string(), (pathname) => {
        const next = nextRoute(pathname, "signedOut");
        return next === null ? pathname === LOGIN_PATH : next === LOGIN_PATH;
      }),
      { numRuns: 200 }
    );
  });
});

test.describe("the boot decision is a total transition", () => {
  const probe = oneof(
    constant(undefined),
    record({ signedIn: boolean(), userId: string() })
  );

  test("a boot that never answered asks at most once more", () => {
    assert(
      property(boolean(), (retried) => {
        const action = bootStep({
          booted: false,
          loading: false,
          data: undefined,
          retried,
        });
        return retried
          ? action.kind === "signOut" && action.end === "probe-unanswered"
          : action.kind === "retry";
      }),
      { numRuns: 20 }
    );
  });
  test("a boot that already answered decides nothing, and never retries", () => {
    assert(
      property(probe, boolean(), (data, booted) => {
        const action = bootStep({
          booted,
          loading: false,
          data,
          retried: false,
        });
        if (booted) return action.kind === "wait";
        if (data === undefined) return action.kind === "retry";
        return action.kind === "signIn" || action.kind === "signOut";
      }),
      { numRuns: 100 }
    );
  });
  test("a live session is never answered with a form", () => {
    assert(
      property(string(), (userId) => {
        const action = bootStep({
          booted: false,
          loading: false,
          data: { signedIn: true, userId },
          retried: false,
        });
        return action.kind === "signIn" && action.userId === userId;
      }),
      { numRuns: 50 }
    );
  });
});

test.describe("the session end has one policy per reason", () => {
  const reasons = constantFrom<SessionEnd>(
    { kind: "signed-out" },
    { kind: "expired" },
    { kind: "boot", end: "probe-unanswered" },
    { kind: "boot", end: "signed-out" }
  );

  test("the reader is told exactly when they must act or understand why", () => {
    assert(
      property(reasons, (end) => {
        const explained =
          end.kind === "expired" ||
          (end.kind === "boot" && end.end === "probe-unanswered");
        return (endNote(end) !== null) === explained;
      }),
      { numRuns: 20 }
    );
  });
  test("only a boot end keeps the credential", () => {
    assert(
      property(
        reasons,
        (end) => keepsCredential(end) === (end.kind === "boot")
      ),
      { numRuns: 20 }
    );
  });
});

test.describe("the session generation is final", () => {
  type Command = { kind: "bump" } | { kind: "response"; at: number };

  test("a generation dropped by a sign-out can never write again", () => {
    assert(
      property(
        array(
          oneof(
            constant<Command>({ kind: "bump" }),
            nat(6).map((at): Command => ({ kind: "response", at }))
          ),
          { maxLength: 12 }
        ),
        (commands) => {
          const epoch = createEpoch();
          // Every generation that was in flight when a bump happened.
          const orphaned = new Set<number>();
          for (const command of commands) {
            if (command.kind === "bump") {
              orphaned.add(epoch.current());
              epoch.bump();
              continue;
            }
            // A response may write only if its generation was never dropped.
            const written = epoch.admits(command.at);
            if (orphaned.has(command.at)) return !written;
          }
          return true;
        }
      ),
      { numRuns: 300 }
    );
  });
  test("the current generation always admits itself", () => {
    assert(
      property(nat(5), (bumps) => {
        const epoch = createEpoch();
        for (let i = 0; i < bumps; i++) epoch.bump();
        return epoch.admits(epoch.current());
      }),
      { numRuns: 50 }
    );
  });
});

test.describe("the search result has one answer per case", () => {
  test("only a stated class gives a figure a scope", () => {
    assert(
      property(boolean(), boolean(), (hasClass, rollWhenClassed) => {
        // Without a class there is no register read, so there is no row either.
        const hasRoll = hasClass && rollWhenClassed;
        const result = searchResult(undefined, searched(hasClass, hasRoll));
        if (!hasClass)
          return result.scope === undefined && result.student === null;
        return (
          result.scope !== undefined && (result.student !== null) === hasRoll
        );
      }),
      { numRuns: 50 }
    );
  });
  test("a refused session never puts a note on the search panel", () => {
    assert(
      property(
        string(),
        (message) =>
          searchResult(new ApiError(401, message), null).note === null
      ),
      { numRuns: 50 }
    );
  });
});

test.describe("a superseded cascade run owns nothing further", () => {
  type Command = "start" | "supersede" | "finish";

  test("at most one run owns the screen, and an aborted run never does", () => {
    assert(
      property(
        array(constantFrom<Command>("start", "supersede", "finish"), {
          maxLength: 12,
        }),
        (steps) => {
          const run = createCascadeRun();
          const signals: AbortSignal[] = [];
          let current: AbortSignal | null = null;
          for (const step of steps) {
            if (step === "start") {
              current = run.start();
              signals.push(current);
            } else if (step === "supersede") run.supersede();
            else if (current) run.finish(current);
            const owners = signals.filter((signal) => run.owns(signal));
            if (owners.length > 1 || owners.some((signal) => signal.aborted))
              return false;
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
  test("a failed run keeps partial options only while it still owns the screen", () => {
    assert(
      property(boolean(), (supersedeFirst) => {
        const run = createCascadeRun();
        const signal = run.start();
        if (supersedeFirst) run.supersede();
        const partial = { sel: EMPTY_SEL, opts: EMPTY_OPTS };
        return supersedeFirst
          ? run.keepPartial(signal, partial) === null
          : run.keepPartial(signal, partial) === partial;
      }),
      { numRuns: 20 }
    );
  });
});

test.describe("the load snap is claimed once or not at all", () => {
  type Command = "arm" | "edit" | "consume";
  const commands = constantFrom<Command>("arm", "edit", "consume");

  test("a typed edit and a finished load cannot both claim the snap", () => {
    assert(
      property(array(commands, { maxLength: 12 }), (steps) => {
        const snap = createLoadSnap();
        let armed = false;
        let claimed = false;
        for (const step of steps) {
          if (step === "arm") {
            snap.arm();
            armed = true;
            claimed = false;
          } else if (step === "edit") {
            snap.disarm();
            armed = false;
          } else {
            const fired = snap.consume();
            if (fired && (!armed || claimed)) return false;
            if (fired) claimed = true;
            armed = false;
          }
        }
        return true;
      }),
      { numRuns: 200 }
    );
  });
  test("a real load always arms the one snap it owes", () => {
    assert(
      property(nat(5), (edits) => {
        const snap = createLoadSnap();
        for (let i = 0; i < edits; i++) snap.disarm();
        snap.arm();
        return snap.consume();
      }),
      { numRuns: 50 }
    );
  });
});

test.describe("the load gate never contradicts itself", () => {
  test("finding-start means the walk is the only thing the reader waits on", () => {
    assert(
      property(
        record({
          optionsLoading: boolean(),
          registerLoading: boolean(),
          preLoading: boolean(),
          rememberedStart: oneof(
            constant<string | null>(null),
            constant<string | null>("01/07/2026")
          ),
          rangeEdited: constantFrom(
            "" as const,
            "from" as const,
            "to" as const
          ),
        }),
        (input) => {
          const gate = loadGate(input);
          if (gate !== "finding-start") return true;
          return (
            input.preLoading &&
            !input.rememberedStart &&
            input.rangeEdited !== "from" &&
            !input.optionsLoading &&
            !input.registerLoading
          );
        }
      ),
      { numRuns: 300 }
    );
  });
  test("a typed From always lifts the gate", () => {
    assert(
      property(
        boolean(),
        (preLoading) =>
          loadGate({
            optionsLoading: false,
            registerLoading: false,
            preLoading,
            rememberedStart: null,
            rangeEdited: "from",
          }) === "ready"
      ),
      { numRuns: 50 }
    );
  });
  test("a remembered start always lifts the gate", () => {
    assert(
      property(
        boolean(),
        (preLoading) =>
          loadGate({
            optionsLoading: false,
            registerLoading: false,
            preLoading,
            rememberedStart: "01/07/2026",
            rangeEdited: "",
          }) === "ready"
      ),
      { numRuns: 50 }
    );
  });
});

test.describe("the panel has no illegal transition", () => {
  test("opening always wins over a slide-out in flight", () => {
    const opened = openPanel(student("21CS001"));
    const closing = closePanel(opened);
    const reopened = openPanel(student("21CS001"));
    // A late exit after a reopen must not wipe the live panel.
    expect(finishClose(reopened).status).toBe("open");
    expect(isPanelOpen(reopened)).toBe(true);
    expect(isPanelOpen(closing)).toBe(false);
    expect(closing.student?.roll).toBe("21CS001");
    expect(finishClose(closing).status).toBe("closed");
  });
  test("closing a closed panel is a no-op, and only open fires a read", () => {
    expect(closePanel(CLOSED_PANEL)).toEqual(CLOSED_PANEL);
    expect(finishClose(CLOSED_PANEL)).toEqual(CLOSED_PANEL);
    expect(isPanelOpen(CLOSED_PANEL)).toBe(false);
  });
});

test.describe("the session view cannot be half-set", () => {
  test("signed in implies the boot read answered", () => {
    assert(
      property(
        constantFrom(
          "booting" as const,
          "signedOut" as const,
          "signedIn" as const
        ),
        (view) => !isSignedIn(view) || isBooted(view)
      ),
      { numRuns: 10 }
    );
  });
});

test.describe("the installed update reaches one offer", () => {
  test("no old controller means no offer and no apply, whatever arrives", () => {
    const silent = oneof(
      constant<UpdateEvent>({
        kind: "boot",
        hasController: false,
        hasWaiting: true,
      }),
      constant<UpdateEvent>({
        kind: "boot",
        hasController: false,
        hasWaiting: false,
      }),
      constant<UpdateEvent>({ kind: "updatefound" }),
      constant<UpdateEvent>({
        kind: "worker-state",
        state: "installed",
        hasController: false,
      }),
      constant<UpdateEvent>({
        kind: "worker-state",
        state: "activating",
        hasController: false,
      }),
      constant<UpdateEvent>({ kind: "answered", confirmed: true })
    );
    assert(
      property(array(silent, { maxLength: 12 }), (events) => {
        let phase: UpdatePhase = FIRST_PHASE;
        for (const event of events) {
          const { phase: next, action } = updateStep(phase, event);
          phase = next;
          if (action === "offer" || action === "apply") return false;
        }
        return true;
      }),
      { numRuns: 300 }
    );
  });
});
