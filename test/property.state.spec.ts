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

import {
  absenceResult,
  advance,
  endAtCap,
  walking,
} from "../server/absence-walk";
import type { AbsenceStep } from "../server/absence-walk";
import { backlogStep, startCursor } from "../server/backlog-cursor";
import type { BacklogCursor } from "../server/backlog-cursor";
import { classResolution } from "../server/class-resolution";
import type { ClassSemester } from "../server/class-resolution";
import { endScan, scanStep, startScan } from "../server/find-scan";
import type { SectionRead, SectionScan } from "../server/find-scan";
import { HttpError } from "../server/http-error";
import {
  livenessGuard,
  markTouched,
  untouched,
} from "../server/liveness-guard";
import type { Option, Student } from "../shared/api";
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

const anAbsenceStep = () =>
  oneof(
    constant<AbsenceStep>({ kind: "refused" }),
    constant<AbsenceStep>({ kind: "dateless" }),
    record({
      start: string({ minLength: 1 }),
      days: array(string({ maxLength: 3 }), { maxLength: 3 }),
    }).map((r): AbsenceStep => ({ kind: "read", start: r.start, days: r.days }))
  );

test.describe("the full-semester absence walk keeps what it read", () => {
  test("the answer is exactly the months read, oldest first", () => {
    assert(
      property(array(anAbsenceStep(), { maxLength: 14 }), (steps) => {
        let walk = walking;
        const readDays: string[] = [];
        let monthsRead = 0;
        let oldest: string | null = null;
        let stopped = false;
        for (const step of steps) {
          if (stopped) continue;
          walk = advance(walk, step);
          if (step.kind === "read") {
            readDays.unshift(...step.days);
            monthsRead++;
            oldest = step.start;
          }
          if (walk.kind !== "walking") stopped = true;
        }
        const answer = absenceResult(endAtCap(walk), "31/10/2026");
        return (
          JSON.stringify(answer.absent) ===
            JSON.stringify(monthsRead ? readDays : null) &&
          JSON.stringify(answer.range) ===
            JSON.stringify(oldest ? { from: oldest, to: "31/10/2026" } : null)
        );
      }),
      { numRuns: 200 }
    );
  });
  test("a dateless month or a refusal ends the walk for good", () => {
    assert(
      property(anAbsenceStep(), anAbsenceStep(), (first, later) => {
        const stopped = advance(walking, first);
        if (stopped.kind === "walking") return true;
        const after = advance(stopped, later);
        const before = absenceResult(stopped, "31/10/2026");
        const again = absenceResult(after, "31/10/2026");
        return (
          after.kind === stopped.kind &&
          JSON.stringify(before) === JSON.stringify(again)
        );
      }),
      { numRuns: 200 }
    );
  });
});

const aSectionRead = () =>
  oneof(
    constant<SectionRead<Student>>({
      kind: "refused",
      error: new HttpError(502, "bad shape"),
    }),
    record({ key: string(), found: boolean() }).map(
      (r): SectionRead<Student> => ({
        kind: "answered",
        section: { value: r.key, label: r.key, title: "" },
        row: r.found ? student("21CS001") : null,
      })
    )
  );

test.describe("the section scan has one outcome", () => {
  test("a roll once found cannot be lost by later sections", () => {
    const found: SectionRead<Student> = {
      kind: "answered",
      section: { value: "A", label: "A", title: "" },
      row: student("21CS001"),
    };
    assert(
      property(array(aSectionRead(), { maxLength: 8 }), (later) => {
        const foundScan = scanStep(startScan<Student>(), found);
        if (foundScan.kind !== "found") return false;
        let scan: SectionScan<Student> = foundScan;
        for (const read of later) scan = scanStep(scan, read);
        return (
          scan.kind === "found" &&
          scan.section === foundScan.section &&
          scan.row === foundScan.row
        );
      }),
      { numRuns: 200 }
    );
  });
  test("a refusal is reported only when no section answered", () => {
    assert(
      property(array(aSectionRead(), { maxLength: 10 }), (reads) => {
        let scan = startScan<Student>();
        let answered = false;
        for (const read of reads) {
          scan = scanStep(scan, read);
          if (read.kind === "answered") answered = true;
        }
        return endScan(scan).kind !== "refused" || !answered;
      }),
      { numRuns: 300 }
    );
  });
});

const anOption = (label: string): Option => ({
  value: label,
  label,
  title: "",
});

test.describe("class resolution ties the inferred flag to its branch", () => {
  test("the flag is true exactly when the semester was inferred", () => {
    assert(
      property(boolean(), (inferred) => {
        const semester: ClassSemester = {
          kind: inferred ? "inferred" : "stated",
          option: anOption("III Semester"),
        };
        const resolved = classResolution({
          course: anOption("B.Tech"),
          branch: anOption("IT"),
          semester,
          sections: [anOption("A")],
          noSectionsReason: "none",
        });
        return (
          resolved.kind === "resolved" &&
          resolved.value.semesterInferred === inferred &&
          resolved.value.levels.semester === semester.option
        );
      }),
      { numRuns: 50 }
    );
  });
  test("no section offered is always unstated with the given reason", () => {
    assert(
      property(string(), string(), (courseLabel, reason) => {
        const resolved = classResolution({
          course: anOption(courseLabel),
          branch: anOption("IT"),
          semester: {
            kind: "stated",
            option: anOption("III Semester"),
          },
          sections: [],
          noSectionsReason: reason,
        });
        return resolved.kind === "unstated" && resolved.reason === reason;
      }),
      { numRuns: 100 }
    );
  });
});

test.describe("the liveness guard never answers an unprobed call", () => {
  test("a call is probed exactly until it touches ECAP", () => {
    assert(
      property(nat(20), (reads) => {
        let touch = untouched;
        for (let i = 0; i < reads; i++) touch = markTouched();
        return livenessGuard(touch).kind === (reads ? "answer" : "probe");
      }),
      { numRuns: 100 }
    );
  });
});

const aBacklogCell = () =>
  oneof(
    constant("I Semester"),
    constant("II Semester"),
    constant("MA101"),
    constant("Total backlogs: 2"),
    string({ maxLength: 8 })
  );

test.describe("the backlog cursor has two states", () => {
  test("a subject cell is filled only after its semester header", () => {
    assert(
      property(array(aBacklogCell(), { maxLength: 14 }), (cells) => {
        let cursor: BacklogCursor = startCursor;
        let opened = false;
        for (const text of cells) {
          const wasAwaiting = cursor.kind === "awaiting-subjects";
          const { cursor: next, kind } = backlogStep(cursor, text);
          if (kind === "open-row") opened = true;
          if (kind === "fill-subjects") {
            if (!wasAwaiting || !opened) return false;
            opened = false;
          }
          cursor = next;
        }
        return true;
      }),
      { numRuns: 300 }
    );
  });
  test("a stated total ends the table with its own count", () => {
    assert(
      property(boolean(), nat(99), (awaiting, count) => {
        const cursor: BacklogCursor = awaiting
          ? { kind: "awaiting-subjects" }
          : { kind: "awaiting-semester" };
        const step = backlogStep(cursor, `Total backlogs: ${count}`);
        return step.kind === "stop" && step.total === count;
      }),
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
