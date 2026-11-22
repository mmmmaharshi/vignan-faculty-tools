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
import type {
  DayWorkCell,
  DayWorkSection,
  FindReply,
  Option,
  Student,
  TodayClass,
} from "../shared/api";
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
import {
  postingsPhase,
  reportBranches,
  shownBranch,
  slotStatus,
  SLOT_STATUS_LABEL,
} from "../web/home/postings-phase";
import { todayPhase } from "../web/home/today-phase";
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
            if (next === null || next === current) {
              return hops <= 2;
            }
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
        if (booted) {
          return action.kind === "wait";
        }
        if (data === undefined) {
          return action.kind === "retry";
        }
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
            if (orphaned.has(command.at)) {
              return !written;
            }
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
        for (let i = 0; i < bumps; i++) {
          epoch.bump();
        }
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
        const result = searchResult(
          undefined,
          searched(hasClass, hasRoll),
          false
        );
        if (!hasClass) {
          return result.scope === undefined && result.student === null;
        }
        return (
          result.scope !== undefined && (result.student !== null) === hasRoll
        );
      }),
      { numRuns: 50 }
    );
  });
  test("idle means no ask, pending means an ask in flight", () => {
    assert(
      property(
        boolean(),
        oneof(constant<FindReply | null>(null), constant(searched(true, true))),
        (loading, data) => {
          const { kind } = searchResult(undefined, data, loading);
          return loading
            ? kind === "pending"
            : kind === (data ? "found" : "idle");
        }
      ),
      { numRuns: 50 }
    );
  });
  test("a refused session never puts a note on the search panel", () => {
    assert(
      property(
        string(),
        boolean(),
        (message, loading) =>
          searchResult(new ApiError(401, message), null, loading).note === null
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
          const signals: Array<AbortSignal> = [];
          let current: AbortSignal | null = null;
          for (const step of steps) {
            if (step === "start") {
              current = run.start();
              signals.push(current);
            } else if (step === "supersede") {
              run.supersede();
            } else if (current) {
              run.finish(current);
            }
            const owners = signals.filter((signal) => run.owns(signal));
            if (owners.length > 1 || owners.some((signal) => signal.aborted)) {
              return false;
            }
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
        if (supersedeFirst) {
          run.supersede();
        }
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
            if (fired && (!armed || claimed)) {
              return false;
            }
            if (fired) {
              claimed = true;
            }
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
        for (let i = 0; i < edits; i++) {
          snap.disarm();
        }
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
          if (gate !== "finding-start") {
            return true;
          }
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
          constant<Array<TodayClass> | null>(null),
          array(todayClassArb, { maxLength: 3 })
        ),
        boolean(),
        (classes, failed) => {
          const phase = todayPhase({
            classes,
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
        const phase = todayPhase({ classes, note: null });
        return phase.kind === "cleared"
          ? classes.length === 0
          : phase.kind === "day" && classes.length > 0;
      }),
      { numRuns: 200 }
    );
  });
  test("the note, never a blank, decides which no-data phase the timetable shows", () => {
    assert(
      property(boolean(), (failed) => {
        const phase = todayPhase({
          classes: null,
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
          const shown = shownBranch(branches, asked || null);
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
          constant<Array<DayWorkSection> | null>(null),
          array(sectionArb, { maxLength: 4 })
        ),
        boolean(),
        (sections, failed) => {
          const phase = postingsPhase({
            sections,
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
  test("a second updatefound never drops an offer already made", () => {
    assert(
      property(
        constantFrom("installed-waiting" as const, "updating" as const),
        (phase) => {
          const step = updateStep(phase, { kind: "updatefound" });
          return step.phase === phase && step.action === "none";
        }
      ),
      { numRuns: 20 }
    );
  });
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
          if (action === "offer" || action === "apply") {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 300 }
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
        const readDays: Array<string> = [];
        let monthsRead = 0;
        let oldest: string | null = null;
        let stopped = false;
        for (const step of steps) {
          if (stopped) {
            continue;
          }
          walk = advance(walk, step);
          if (step.kind === "read") {
            readDays.unshift(...step.days);
            monthsRead++;
            oldest = step.start;
          }
          if (walk.kind !== "walking") {
            stopped = true;
          }
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
        if (stopped.kind === "walking") {
          return true;
        }
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
        if (foundScan.kind !== "found") {
          return false;
        }
        let scan: SectionScan<Student> = foundScan;
        for (const read of later) {
          scan = scanStep(scan, read);
        }
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
          if (read.kind === "answered") {
            answered = true;
          }
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
        for (let i = 0; i < reads; i++) {
          touch = markTouched();
        }
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
          const step = backlogStep(cursor, text);
          if (step.kind === "stop") {
            return step.total >= 0;
          }
          const { cursor: next, kind } = step;
          if (kind === "open-row") {
            opened = true;
          }
          if (kind === "fill-subjects") {
            if (!wasAwaiting || !opened) {
              return false;
            }
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
