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

import type {
  DayWorkCell,
  DayWorkSection,
  Student,
  TodayClass,
} from "../shared/api";
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
import { bootStep, isBooted, isSignedIn } from "../web/app/session-view";
import { createEpoch } from "../web/data/session-epoch";
import { FIRST_PHASE, updateStep } from "../web/data/update-lifecycle";
import type { UpdateEvent, UpdatePhase } from "../web/data/update-lifecycle";
import {
  postingsPhase,
  reportBranches,
  shownBranch,
  slotStatus,
  SLOT_STATUS_LABEL,
} from "../web/home/postings-phase";
import { todayPhase } from "../web/home/today-phase";

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

const refusal = { kind: "error" as const, text: "down" };
const todayClassArb = record<TodayClass>({
  period: constant("Period 1"),
  time: constant("08:45 AM- 09:35 AM"),
  subject: constant("AI"),
  section: constant("3 IT-C"),
  room: constant(""),
});
const sectionArb = record({ branch: string(), section: string() }).map(
  ({ branch, section }): DayWorkSection => ({
    branch,
    branchShort: branch,
    semester: "I Semester",
    section,
    cells: [],
  })
);

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

test.describe("a presentational surface is never neither showing nor loading", () => {
  test("the timetable phase carries exactly the classes it was given", () => {
    assert(
      property(
        oneof(
          constant<TodayClass[] | null>(null),
          array(todayClassArb, { maxLength: 3 })
        ),
        boolean(),
        boolean(),
        (classes, busy, failed) => {
          const phase = todayPhase({
            classes,
            busy,
            note: failed ? refusal : null,
          });
          if (classes === null) {
            return phase.kind === "unread" || phase.kind === "failed";
          }
          return (
            (phase.kind === "day" || phase.kind === "cleared") &&
            "classes" in phase &&
            phase.classes === classes
          );
        }
      ),
      { numRuns: 200 }
    );
  });
  test("a stated day never reads as cleared, and an empty one invents no periods", () => {
    assert(
      property(array(todayClassArb, { maxLength: 4 }), (classes) => {
        const phase = todayPhase({ classes, busy: false, note: null });
        return phase.kind === "cleared"
          ? classes.length === 0
          : phase.kind === "day" && classes.length > 0;
      }),
      { numRuns: 200 }
    );
  });
  test("the note, never a blank, decides which no-data phase the timetable shows", () => {
    assert(
      property(boolean(), boolean(), (busy, failed) => {
        const phase = todayPhase({
          classes: null,
          busy,
          note: failed ? refusal : null,
        });
        return failed ? phase.kind === "failed" : phase.kind === "unread";
      }),
      { numRuns: 50 }
    );
  });
  test("the branch on show is always one the report named", () => {
    assert(
      property(
        array(sectionArb, { maxLength: 6 }),
        string(),
        (sections, asked) => {
          const branches = reportBranches(sections);
          const shown = shownBranch(sections, asked || null);
          return shown === null
            ? branches.length === 0
            : branches.includes(shown);
        }
      ),
      { numRuns: 200 }
    );
  });
  test("the postings phase names a report only when the report stated sections", () => {
    assert(
      property(
        oneof(
          constant<DayWorkSection[] | null>(null),
          array(sectionArb, { maxLength: 4 })
        ),
        boolean(),
        (sections, failed) => {
          const phase = postingsPhase({
            sections,
            busy: false,
            note: failed ? refusal : null,
          });
          if (sections === null) {
            return failed ? phase.kind === "failed" : phase.kind === "loading";
          }
          if (phase.kind === "report") {
            return phase.sections === sections && sections.length > 0;
          }
          return sections.length === 0 && phase.kind === "none";
        }
      ),
      { numRuns: 200 }
    );
  });
  test("a period's typed status and its label are never blank", () => {
    assert(
      property(
        boolean(),
        oneof(constant<boolean | null>(null), boolean()),
        (hasCell, posted) => {
          const cell: DayWorkCell | null = hasCell
            ? {
                period: "1",
                subject: "MFCS",
                posted: posted ?? false,
                staff: "",
                present: "",
                absent: "",
                absentRolls: [],
              }
            : null;
          const status = slotStatus(cell);
          return (
            SLOT_STATUS_LABEL[status].length > 0 &&
            (status === "no-class") === (cell === null)
          );
        }
      ),
      { numRuns: 100 }
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
