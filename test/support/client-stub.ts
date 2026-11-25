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
const clockTime = (d: Date): string => {
  const hour = d.getHours() % 12 || 12;
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${hour}:${minute} ${d.getHours() < 12 ? "AM" : "PM"}`;
};
/** An hour each way from a moment, so a stubbed period spans "now" whenever
 *  the test runs: the highlight is asserted, not the hour. */
const aroundNow = (at: number): string =>
  `${clockTime(new Date(at - 30 * 60_000))}- ${clockTime(new Date(at + 30 * 60_000))}`;
/** The slid session an answer carries, the way the real server sends it. */
export const sessionAnswer = (wasIn: boolean) => {
  const encoded = Buffer.from(
    JSON.stringify({
      userId: "faculty",
      password: "secret",
      cookies: [["frmAuth", "ok"]],
      at: Date.now(),
    }),
    "utf8"
  ).toString("base64url");
  const headers = Object.fromEntries(
    wasIn ? [[SESSION_HEADER, encoded] as const] : []
  );
  return {
    headers,
    body: JSON.stringify({
      signedIn: wasIn,
      userId: wasIn ? "faculty" : "",
    }),
  };
};

/** The rolls the student panel asked for, in the order it asked. */
export const profileRolls: Array<string> = [];
/** The semester starts each student panel asked its totals over. */
export const totalsAsked: Array<string> = [];
/** A read the stub can park for the test to answer late. */
export type Holdable =
  | "session"
  | "walk"
  | "profile"
  | "find"
  | "options"
  | "register";
/** A parked read: the route plus what the answer must remember about the
 *  moment of asking — a held session answer belongs to the session that
 *  asked for it, not to whatever signed in or out while it was in flight. */
type Parked = { route: Route; wasIn: boolean };
/** Everything the stub answers from and has answered so far. One mutable
 *  object, because every spec file in this family shares this module and a
 *  binding imported from it cannot be assigned. `resetStub()` is where each
 *  test starts. */
export const state = {
  /** What the last read of `/api/session` said, and what the stub has been asked
   *  for so far. Reset for each test. */
  signedIn: false,
  sessionCalls: 0,
  /** Reads parked for the test to answer late, by read. One mechanism for
   *  every holdable read: `hold` arms, the stub parks instead of answering,
   *  and `release` answers the oldest parked route with the test's answer.
   *  The queue keeps the in-flight request first, so a revalidation can
   *  never stand in for it; the release ends the hold, so whatever the
   *  test does next is answered. Leftovers are discarded at reset. */
  armed: new Set<Holdable>(),
  holds: new Map<Holdable, Array<Parked>>(),
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
  state.armed.clear();
  state.holds.clear();
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
/** Arms `read` to park instead of answering. Sticky until the release:
 *  the settle loop can ask again while the first answer is still held back. */
export const hold = (read: Holdable): void => {
  state.armed.add(read);
};
/** Answers the oldest parked `read` with the test's answer. Fails fast
 *  where nothing is parked: a release without a hold is a broken test,
 *  not an empty reply. The release ends the hold even when the queue still
 *  has entries: the test held one answer back, and what it does next —
 *  like the sign-out test's reload — must be answered, not parked. Queued
 *  leftovers are discarded at the next reset. */
export const release = async (
  read: Holdable,
  answer: (held: Parked) => Promise<void>
): Promise<void> => {
  const queue = state.holds.get(read) ?? [];
  const held = queue.shift();
  if (!held) {
    throw new Error(`release with no parked ${read} read`);
  }
  state.armed.delete(read);
  if (queue.length === 0) {
    state.holds.delete(read);
  }
  await answer(held);
};
/** Parks `route` when `read` is armed. True where the caller must not also
 *  answer: one mechanism for every holdable read. The snapshot rides along
 *  because a held answer belongs to the session that asked for it. */
const park = (read: Holdable, route: Route): boolean => {
  if (!state.armed.has(read)) {
    return false;
  }
  const queue = state.holds.get(read) ?? [];
  queue.push({ route, wasIn: state.signedIn });
  state.holds.set(read, queue);
  return true;
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
/** Answers a parked register read with the same body and remembered window
 *  as an immediate one, including its refusal switch. */
export const releaseRegister = async (): Promise<void> => {
  await release("register", async (held) => {
    const asked = held.route.request().postDataJSON() as RegisterRequest;
    state.lastRegisterFrom = asked.from;
    if (state.registerFails) {
      await held.route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Your session has expired." }),
      });
      return;
    }
    const overall = asked.subject?.value === ALL_SUBJECTS.value;
    await held.route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(registerReply(overall ? null : 6, overall)),
    });
  });
};
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
  name: `${roll} Student`,
  roll,
  cgpa: roll === "21C" ? "NA" : "5.61",
  credits: roll === "21C" ? "" : "16/19",
  cgpaPercent: roll === "21C" ? "" : "48.55",
  sgpa:
    roll === "21C"
      ? []
      : [
          {
            semester: "I Semester",
            value: "5.61",
            subjects: [
              { code: "LAC", grade: "E" },
              { code: "EP", grade: "F" },
            ],
          },
        ],
  phones: roll === "21C" ? [] : [{ label: "Mobile.No", number: "9876543210" }],
  backlogs: backlogsFor(roll),
});
/** One `/api/student` answer for the ask it answers: the profile, the
 *  day-wise grid where the register states none, the semester's counts and
 *  the month table. Exported so a test holding the read can answer it late
 *  with the same body the stub would have sent. */
export const studentReply = (asked: StudentRequest): StudentProfile => {
  const { roll, register, semStart } = asked;
  const allSubjects = register?.subject?.value === ALL_SUBJECTS.value;
  const reply: StudentProfile = { ...profileFor(roll) };
  if (allSubjects) {
    reply.absent = ["02/09"];
  }
  if (semStart) {
    reply.totals = { held: 21, attend: 21, absent: 0 };
    reply.months = [
      { month: { from: "05/08/2026", to: "31/08/2026" }, pct: 65 },
      { month: { from: "01/09/2026", to: "30/09/2026" }, pct: 75.5 },
    ];
  }
  return reply;
};
/** Answers a parked profile read the way an immediate one answers. */
export const releaseProfile = async (): Promise<void> => {
  await release("profile", async (held) => {
    const asked = held.route.request().postDataJSON() as StudentRequest;
    await held.route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(studentReply(asked)),
    });
  });
};
/** One `/api/find` answer for a roll, shared by the stub and a held release. */
export const findReply = (roll: string) => {
  const reply = registerReply(null, true);
  const student = reply.students.find((row) => row.roll === roll) ?? null;
  if (student) {
    student.absent = ["02/09"];
  }
  return {
    profile: profileFor(roll),
    statedClass: {
      course: "B.Tech",
      semester: "I Semester",
      branch: "IT",
      section: student ? "Section-1" : "",
    },
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
  };
};
/** Answers a parked find read the way an immediate one answers. */
export const releaseFind = async (): Promise<void> => {
  await release("find", async (held) => {
    const { roll } = held.route.request().postDataJSON() as FindRequest;
    await held.route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(findReply(roll)),
    });
  });
};
/** The stored session answers carry, built the way the real server sends it. */
export const storedSessionHeader = () => ({
  [SESSION_HEADER]: Buffer.from(
    JSON.stringify({
      userId: "faculty",
      password: "secret",
      cookies: [["frmAuth", "ok"]],
      at: Date.now(),
    }),
    "utf8"
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
    // A held answer belongs to the session that asked for it, not to
    // whatever signed in or out while it was in flight.
    if (park("session", route)) {
      return;
    }
    // Like the real server, every answer carries the slid session back, so
    // the browser stores it — including one that lands after a sign-out.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      ...sessionAnswer(state.signedIn),
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
    if (park("options", route)) {
      return;
    }
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
    if (park("register", route)) {
      return;
    }
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
      if (park("walk", route)) {
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
    const asked = request.postDataJSON() as StudentRequest;
    const { roll, register, semStart } = asked;
    profileRolls.push(roll);
    if (semStart) {
      totalsAsked.push(semStart);
    }
    // The All subjects report states no dates, so the panel asks for this
    // student's own grid over the same range; the stub answers as that report
    // would. A subject register's rows already carry their dates, so nothing is
    // asked for.
    const allSubjects = register?.subject?.value === ALL_SUBJECTS.value;
    state.absentAsked ||= allSubjects;
    if (park("profile", route)) {
      return;
    }
    await json(studentReply(asked));
    return;
  }
  if (path === "/api/find") {
    state.findCalls += 1;
    const { roll } = request.postDataJSON() as FindRequest;
    if (park("find", route)) {
      return;
    }
    await json(findReply(roll));
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
              absentRolls: ["21B", "21C", "22A", "23B", "24C"],
            },
            {
              period: "2",
              subject: "SE",
              posted: false,
              staff: "Other Two",
              present: "",
              absent: "",
              absentRolls: [],
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
              // Posted, and nobody was missing: the modal says "None listed"
              // rather than leaving the reader to read a gap as a fault.
              period: "1",
              subject: "MFCS",
              posted: true,
              staff: "Third Person",
              present: "35",
              absent: "0",
              absentRolls: [],
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
  if (index < 0) {
    return null;
  }
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
