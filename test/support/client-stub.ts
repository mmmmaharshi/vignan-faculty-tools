import { expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { ALL_SUBJECTS, SESSION_HEADER } from "../../shared/api";
import type {
  FindRequest,
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
  StudentBacklogs,
  StudentProfile,
  StudentRequest,
} from "../../shared/api";

/*
 * The data layer, over a stubbed API and no credentials.
 *
 * `smoke.spec.ts` drives the real Portal, because the Portal's own wire is not
 * something a stub can vouch for. This is the other half: the app's own fetch
 * layer — the keys, the click-only register, the probe, the sweep on sign-out —
 * exercised in a browser, where SWR's behaviour actually happens. The API is
 * stubbed in the *browser*, so nothing here reaches ECAP.
 */

/** A clock time, so a stubbed period can name hours the panel can read. */
export const clockTime = (d: Date): string => {
  const hour = d.getHours() % 12 || 12;
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${hour}:${minute} ${d.getHours() < 12 ? "AM" : "PM"}`;
};
/** An hour each way from a moment, so a stubbed period spans "now" whenever
 *  the test runs: the highlight is asserted, not the hour. */
export const aroundNow = (at: number): string =>
  `${clockTime(new Date(at - 30 * 60_000))}- ${clockTime(new Date(at + 30 * 60_000))}`;
/** The slid session an answer carries, the way the real server sends it. */
export const sessionAnswer = (
  wasIn: boolean
): { headers: Record<string, string>; body: string } => ({
  headers: wasIn
    ? {
        [SESSION_HEADER]: Buffer.from(
          JSON.stringify({
            userId: "faculty",
            password: "secret",
            cookies: [["frmAuth", "ok"]],
            at: Date.now(),
          }),
          "utf-8"
        ).toString("base64url"),
      }
    : {},
  body: JSON.stringify({
    signedIn: wasIn,
    userId: wasIn ? "faculty" : "",
  }),
});

/** The rolls the student panel asked for, in the order it asked. */
export const profileRolls: string[] = [];
/** The semester starts each student panel asked its totals over. */
export const totalsAsked: string[] = [];
/** Everything the stub answers from and has answered so far. One mutable
 *  object, because every spec file in this family shares this module and a
 *  binding imported from it cannot be assigned. `resetStub()` is where each
 *  test starts. */
export const state = {
  /** What the last read of `/api/session` said, and what the stub has been asked
   *  for so far. Reset for each test. */
  signedIn: false,
  sessionCalls: 0,
  /** When true, session reads are held for the test to answer: a probe already
   *  in flight while the user signs out, whose answer lands after the clear. */
  hangSession: false,
  heldSession: null as { route: Route; wasIn: boolean } | null,
  /** When true, settle-time semester walks hang for the test to answer: the
   *  term start ECAP has not named yet while the picker is already settled. */
  hangWalk: false,
  heldWalk: null as Route | null,
  optionsCalls: 0,
  /** The next that many `/api/options` calls answer 502, then answer again:
   *  consecutive portal failures, the way ECAP fails from the server. The loop
   *  re-asks one stumble per pass, so stranding the picker takes two. */
  optionsFailCount: 0,
  /** When true, only passes after the first answer 502: the courses arrive but
   *  the branch call fails, so the picker must keep the courses beside the
   *  error instead of five empty selects. */
  optionsFailAfterFirst: false,
  registerCalls: 0,
  registerFails: false,
  /** The window the last register load asked for, in the Portal's own shape. */
  lastRegisterFrom: "",
  statedFrom: "",
  /** How often the open panel asked for the wider, full-semester window — sent
   *  only when it starts before the register on screen. */
  semAbsencesCalls: 0,
  /** How often the All subjects view probed one subject's earliest held day —
   *  sent only on that path, where the report on screen states no dates. */
  semStartCalls: 0,
  /** How often Student Search asked about a roll number. */
  findCalls: 0,
  /** How often a settled picker without a remembered start walked back for one:
   *  the settle-time probe, kept apart so the per-load probe keeps its count. */
  walkCalls: 0,
  /** What the settle-time walk answers, or null for no start found. Reset for
   *  each test, so only the test that names a walked start can see one. */
  semStartWalkFrom: null as string | null,
  /** How often Home asked for today's timetable — once per opening. */
  todayCalls: 0,
  /** How often Home asked for the branch's unposted periods. */
  unpostedCalls: 0,
  /** When true, the stub answers a cleared day: no periods at all. */
  todayEmpty: false,
  /** Whether the panel asked for a student's own day-wise grid — sent only when
   *  the register on screen states no dates of its own (the All subjects view). */
  absentAsked: false,
};

/** The counters and switches each test starts from. */
export const resetStub = (): void => {
  profileRolls.length = 0;
  totalsAsked.length = 0;
  state.signedIn = false;
  state.sessionCalls = 0;
  state.hangSession = false;
  state.heldSession = null as { route: Route; wasIn: boolean } | null;
  state.hangWalk = false;
  state.heldWalk = null as Route | null;
  state.optionsCalls = 0;
  state.optionsFailCount = 0;
  state.optionsFailAfterFirst = false;
  state.registerCalls = 0;
  state.registerFails = false;
  state.lastRegisterFrom = "";
  state.statedFrom = "";
  state.semAbsencesCalls = 0;
  state.semStartCalls = 0;
  state.findCalls = 0;
  state.walkCalls = 0;
  state.semStartWalkFrom = null as string | null;
  state.todayCalls = 0;
  state.unpostedCalls = 0;
  state.todayEmpty = false;
  state.absentAsked = false;
};
export const opt = (value: string, label: string, title = ""): Option => ({
  value,
  label,
  title,
});
/** The chain, level by level: each pass answers with the level the request has
 *  unlocked. Fixed options, so a settled selection is a known one. */
export const optionsFor = (request: OptionsRequest): OptionsReply => ({
  course: [opt("1", "B.Tech"), opt("2", "M.Tech")],
  semester: request.course ? [opt("3", "III Semester", "2025")] : [],
  branch: request.semester ? [opt("4", "Information Technology")] : [],
  section: request.branch ? [opt("5", "IT-3A"), opt("6", "IT-3B")] : [],
  subject: request.section
    ? [ALL_SUBJECTS, opt("7", "MFCS"), opt("8", "DBMS")]
    : [],
  emptyLevels: [],
});
/** The register's own reply. The All subjects path states no dates at all — its
 *  report aggregates by subject — so its rows carry no absences and the panel
 *  has to ask the Portal for that student's own grid. */
export const registerReply = (
  classesHeld: number | null,
  overall = false
): RegisterReply => ({
  students: [
    {
      sl: "1",
      roll: "21A",
      name: "A student",
      attendedOfHeld: "38/45",
      pct: 84.4,
      irregular: false,
      critical: false,
      overallPct: 81,
      overallAttendedOfHeld: "120/148",
      overallIrregular: false,
      overallCritical: false,
      // The section-wide report states one attended count per subject it
      // offered; a subject register states none.
      subjects: overall ? [90, 80] : [],
      absent: overall ? [] : ["12/10"],
    },
    {
      sl: "2",
      roll: "21B",
      name: "B student",
      attendedOfHeld: "20/45",
      pct: 44.4,
      irregular: true,
      critical: false,
      overallPct: 52,
      overallAttendedOfHeld: "77/148",
      overallIrregular: true,
      overallCritical: false,
      subjects: overall ? [70, null] : [],
      absent: overall ? [] : ["12/10"],
    },
    {
      sl: "3",
      roll: "21C",
      name: "C student",
      attendedOfHeld: "10/45",
      pct: 22.2,
      irregular: true,
      critical: true,
      overallPct: 30,
      overallAttendedOfHeld: "44/148",
      overallIrregular: true,
      overallCritical: true,
      subjects: overall ? [50, null] : [],
      absent: [],
    },
  ],
  summary: {
    total: 3,
    irregular: 2,
    critical: 1,
    irregularBelow: 65,
    criticalBelow: 50,
    average: 50.3,
    overallAverage: 54.3,
    overallIrregular: 2,
    overallCritical: 1,
    range: { from: "01/07/2026", to: "16/10/2026" },
    classesHeld,
    // The section-wide report aggregates by subject and states no dates, so
    // the stub states none on that path either — like the real portal.
    statedFrom: overall ? null : state.statedFrom || null,
    dates: [],
    subjectColumns: overall ? ["MFCS", "WT TEST"] : [],
  },
});
/** The backlogs section of each student's page: one with backlogs, one that says
 *  in words there are none, and one that says nothing about them. */
export const backlogsFor = (roll: string): StudentBacklogs => {
  if (roll === "21B") {
    return {
      rows: [
        {
          semester: "I Semester",
          subjects: [
            { code: "EP", marked: true },
            { code: "Com.Eng", marked: false },
          ],
        },
      ],
      total: 2,
      note: "",
    };
  }
  if (roll === "21C") {
    return { rows: [], total: null, note: "Student have no backlogs" };
  }
  return { rows: [], total: null, note: "" };
};
/** What ECAP states for one student. 21C's page says in words that there are
 *  none, 21A's says nothing about them, and 21B has a backlog to show. */
export const profileFor = (roll: string): StudentProfile => ({
  cgpa: roll === "21C" ? "NA" : "5.61",
  credits: roll === "21C" ? "" : "16/19",
  cgpaPercent: roll === "21C" ? "" : "48.55",
  sgpa: roll === "21C" ? [] : [{ semester: "I Semester", value: "5.61" }],
  phones: roll === "21C" ? [] : [{ label: "Mobile.No", number: "9876543210" }],
  backlogs: backlogsFor(roll),
});
/** The stored session answers carry, built the way the real server sends it. */
export const storedSessionHeader = (): Record<string, string> => ({
  [SESSION_HEADER]: Buffer.from(
    JSON.stringify({
      userId: "faculty",
      password: "secret",
      cookies: [["frmAuth", "ok"]],
      at: Date.now(),
    }),
    "utf-8"
  ).toString("base64url"),
});
export const stub = async (route: Route): Promise<void> => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const json = (body: unknown, status = 200): Promise<void> =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  if (path === "/api/session") {
    state.sessionCalls += 1;
    // Read now: a held answer belongs to the session that asked for it, not
    // to whatever signed in or out while it was in flight.
    const wasIn = state.signedIn;
    if (state.hangSession) {
      state.heldSession = { route, wasIn };
      return;
    }
    // Like the real server, every answer carries the slid session back, so
    // the browser stores it — including one that lands after a sign-out.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      ...sessionAnswer(wasIn),
    });
    return;
  }
  if (path === "/api/login") {
    state.signedIn = true;
    // What the real server answers: the session to store, as a header.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: storedSessionHeader(),
      body: JSON.stringify({ ok: true }),
    });
    return;
  }
  if (path === "/api/logout") {
    state.signedIn = false;
    await json({ ok: true });
    return;
  }
  if (path === "/api/options") {
    state.optionsCalls += 1;
    if (state.optionsFailCount > 0) {
      state.optionsFailCount -= 1;
      await json(
        { error: "ECAP did not answer the course list. Try again." },
        502
      );
      return;
    }
    if (state.optionsFailAfterFirst) {
      const asked = request.postDataJSON() as OptionsRequest;
      if (asked.course) {
        await json(
          {
            error:
              "ECAP rejected the LoadBranchAndSemestersDropDown request (HTTP 500).",
          },
          502
        );
        return;
      }
    }
    await json(optionsFor(request.postDataJSON() as OptionsRequest));
    return;
  }
  if (path === "/api/register") {
    state.registerCalls += 1;
    if (state.registerFails) {
      await json({ error: "Your session has expired." }, 401);
      return;
    }
    // A subject register states its class days in its own grid; the
    // section-wide report aggregates by subject and states none.
    const asked = request.postDataJSON() as RegisterRequest;
    state.lastRegisterFrom = asked.from;

    const overall = asked.subject?.value === ALL_SUBJECTS.value;
    await json(registerReply(overall ? null : 6, overall));
    return;
  }
  if (path === "/api/sem-start") {
    const walked = (request.postDataJSON() as { walkBack?: number }).walkBack;
    if (walked) {
      state.walkCalls += 1;
      if (state.hangWalk) {
        state.heldWalk = route;
        return;
      }
      await json({ statedFrom: state.semStartWalkFrom });
      return;
    }
    state.semStartCalls += 1;
    await json({ statedFrom: "05/08/2026" });
    return;
  }
  if (path === "/api/sem-absences") {
    state.semAbsencesCalls += 1;
    await json({ absent: ["05/08", "06/08"] });
    return;
  }
  if (path === "/api/student") {
    const { roll, register, semStart } =
      request.postDataJSON() as StudentRequest;
    profileRolls.push(roll);
    if (semStart) totalsAsked.push(semStart);
    // The All subjects report states no dates, so the panel asks for this
    // student's own grid over the same range; the stub answers as that report
    // would. A subject register's rows already carry their dates, so nothing is
    // asked for.
    const allSubjects = register?.subject?.value === ALL_SUBJECTS.value;
    state.absentAsked ||= allSubjects;
    await json({
      ...profileFor(roll),
      ...(allSubjects ? { absent: ["02/09"] } : {}),
      // The semester's counts, as the Cumulative register states them.
      ...(semStart ? { totals: { held: 21, attend: 21, absent: 0 } } : {}),
      // The month table, as the class report states it: cumulative from the
      // semester start, one row per month, the figure climbing.
      ...(semStart
        ? {
            months: [
              {
                from: "05/08/2026",
                to: "31/08/2026",
                pct: 65,
              },
              {
                from: "01/09/2026",
                to: "30/09/2026",
                pct: 75.5,
              },
            ],
          }
        : {}),
    });
    return;
  }
  if (path === "/api/find") {
    state.findCalls += 1;
    const { roll } = request.postDataJSON() as FindRequest;
    const reply = registerReply(null, true);
    const student = reply.students.find((row) => row.roll === roll) ?? null;
    if (student) student.absent = ["02/09"];
    await json({
      profile: profileFor(roll),
      class: {
        course: opt("1", "B.Tech"),
        semester: opt("1", "I Semester", "2025"),
        branch: opt("1", "IT"),
        section: student ? opt("1", "Section-1") : null,
        semesterInferred: true,
      },
      window: reply.summary.range,
      student,
      fullAbsent: student ? ["15/07"] : null,
      fullRange: student
        ? { from: "15/07/2026", to: reply.summary.range.to }
        : null,
      note: student ? "" : `No row for ${roll} in B.Tech · I Semester · IT.`,
    });
    return;
  }
  if (path === "/api/today") {
    state.todayCalls += 1;
    // Spans the moment the test runs, so the period is live whenever the
    // clock says it is: the highlight is asserted, not the hour.
    await json(
      state.todayEmpty
        ? { classes: [] }
        : {
            classes: [
              {
                period: "Period 1",
                time: aroundNow(Date.now()),
                subject: "AI",
                section: "3 IT-C",
                room: "",
              },
              // A free period the grid still times: ECAP states the hours and
              // leaves only the class cell blank.
              {
                period: "Period 3",
                time: aroundNow(Date.now()),
                subject: "",
                section: "",
                room: "",
              },
            ],
          }
    );
    return;
  }
  if (path === "/api/unposted") {
    state.unpostedCalls += 1;
    await json({
      date: "24/10/2026",
      sections: [
        {
          branch: "Information Technology",
          branchShort: "IT",
          semester: "III Semester",
          section: "B",
          cells: [
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
          ],
        },
        {
          branch: "Computer Science and Engineering (Artificial Intelligence)",
          branchShort: "CSE (AI)",
          semester: "III Semester",
          section: "B",
          cells: [
            {
              period: "1",
              subject: "MFCS",
              posted: true,
              staff: "Third Person",
              present: "28",
              absent: "2",
            },
          ],
        },
      ],
    });
    return;
  }
  if (path === "/api/faculty-profile") {
    // Long type names on purpose: the seven-column table must survive them
    // on a phone screen.
    await json({
      name: "Test Faculty",
      photo: "",
      designation: "0",
      leaveStatus: [
        {
          type: "Eligible Casual Leave",
          eligible: "15",
          applied: "3",
          approved: "2",
          pending: "1",
          declined: "0",
          available: "12",
        },
      ],
    });
    return;
  }
  await json({ error: `no stub for ${path}` }, 500);
};
/** What a Select shows. Mantine puts the chosen option's *label* in the input,
 *  which is the thing a reader of the screen can see. */
export async function selectValue(
  page: Page,
  label: string
): Promise<string | null> {
  const index = await page.evaluate((text) => {
    const inputs = [
      ...document.querySelectorAll<HTMLInputElement>(
        "input.mantine-Select-input"
      ),
    ];
    return inputs.findIndex((input) => {
      const forIt = document.querySelector(`label[for="${input.id}"]`);
      return (
        forIt?.textContent
          .replace(/\s*\*$/, "")
          .trim()
          .toLowerCase() === text
      );
    });
  }, label.toLowerCase());
  if (index < 0) return null;
  return page.locator("input.mantine-Select-input").nth(index).inputValue();
}
export async function signIn(page: Page): Promise<void> {
  await page.getByLabel("ECAP user name").fill("faculty");
  await page.locator('input[type="password"]').fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
    .toBe("/home");
}
/** Signed in, with the cascade settled on the stub's first class. Sign-in lands
 *  on Home now, so settling is observed over on the Register screen. */
export async function signInAndSettle(page: Page): Promise<void> {
  await page.goto("/login");
  await signIn(page);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect
    .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
    .toBe("ALL SUBJECTS");
}
