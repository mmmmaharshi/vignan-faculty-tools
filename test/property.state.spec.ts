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

import type { Student } from "../shared/api";
import { loadGate } from "../web/app/load-gate";
import {
  CLOSED_PANEL,
  closePanel,
  finishClose,
  isPanelOpen,
  openPanel,
} from "../web/app/panel-state";
import { DASHBOARD_PATH, HOME_PATH, LOGIN_PATH } from "../web/app/paths";
import { nextRoute } from "../web/app/route-guard";
import { isBooted, isSignedIn } from "../web/app/session-view";
import { createEpoch } from "../web/data/session-epoch";

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
        boolean(),
        boolean(),
        (pathname, booted, signedIn) => {
          let current = pathname;
          let hops = 0;
          for (; hops < 5; hops++) {
            const next = nextRoute(current, { booted, signedIn });
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
        const next = nextRoute(pathname, { booted: true, signedIn: true });
        return next !== LOGIN_PATH;
      }),
      { numRuns: 200 }
    );
  });
  test("a signed-out visitor is never kept off the login form", () => {
    assert(
      property(string(), (pathname) => {
        const next = nextRoute(pathname, { booted: true, signedIn: false });
        return next === null ? pathname === LOGIN_PATH : next === LOGIN_PATH;
      }),
      { numRuns: 200 }
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
    assert(
      property(string({ minLength: 1 }), (roll) => {
        const opened = openPanel(student(roll));
        const closing = closePanel(opened);
        const reopened = openPanel(student(roll));
        // A late exit after a reopen must not wipe the live panel.
        expect(finishClose(reopened).status).toBe("open");
        expect(isPanelOpen(reopened)).toBe(true);
        expect(isPanelOpen(closing)).toBe(false);
        expect(closing.student?.roll).toBe(roll);
        expect(finishClose(closing).status).toBe("closed");
        return true;
      }),
      { numRuns: 100 }
    );
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
