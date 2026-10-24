import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { ALL_SUBJECTS, SESSION_HEADER, SESSION_STORE_KEY } from "../shared/api";
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
} from "../shared/api";

/*
 * The data layer, over a stubbed API and no credentials.
 *
 * `smoke.spec.ts` drives the real Portal, because the Portal's own wire is not
 * something a stub can vouch for. This is the other half: the app's own fetch
 * layer — the keys, the click-only register, the probe, the sweep on sign-out —
 * exercised in a browser, where SWR's behaviour actually happens. The API is
 * stubbed in the *browser*, so nothing here reaches ECAP.
 */

const opt = (value: string, label: string, title = ""): Option => ({
  value,
  label,
  title,
});
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
/** What the last read of `/api/session` said, and what the stub has been asked
 *  for so far. Reset for each test. */
let signedIn = false;
let sessionCalls = 0;
let optionsCalls = 0;
let registerCalls = 0;
let registerFails = false;
let statedFrom = "";
/** How often the open panel asked for the wider, full-semester window — sent
 *  only when it starts before the register on screen. */
let semAbsencesCalls = 0;
/** How often the All subjects view probed one subject's earliest held day —
 *  sent only on that path, where the report on screen states no dates. */
let semStartCalls = 0;
const profileRolls: string[] = [];
/** How often Home asked for today's timetable — once per opening. */
let todayCalls = 0;
/** How often Home asked for the branch's unposted periods. */
let unpostedCalls = 0;
/** When true, the stub answers a cleared day: no periods at all. */
let todayEmpty = false;
/** Whether the panel asked for a student's own day-wise grid — sent only when
 *  the register on screen states no dates of its own (the All subjects view). */
let absentAsked = false;
/** The chain, level by level: each pass answers with the level the request has
 *  unlocked. Fixed options, so a settled selection is a known one. */
const optionsFor = (request: OptionsRequest): OptionsReply => ({
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
const registerReply = (
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
    statedFrom: overall ? null : statedFrom || null,
    dates: [],
  },
});
/** The backlogs section of each student's page: one with backlogs, one that says
 *  in words there are none, and one that says nothing about them. */
const backlogsFor = (roll: string): StudentBacklogs => {
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
const profileFor = (roll: string): StudentProfile => ({
  cgpa: roll === "21C" ? "NA" : "5.61",
  credits: roll === "21C" ? "" : "16/19",
  cgpaPercent: roll === "21C" ? "" : "48.55",
  sgpa: roll === "21C" ? [] : [{ semester: "I Semester", value: "5.61" }],
  phones: roll === "21C" ? [] : [{ label: "Mobile.No", number: "9876543210" }],
  backlogs: backlogsFor(roll),
});
const stub = async (route: Route): Promise<void> => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const json = (body: unknown, status = 200): Promise<void> =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  if (path === "/api/session") {
    sessionCalls += 1;
    await json({
      signedIn,
      userId: signedIn ? "faculty" : "",
    });
    return;
  }
  if (path === "/api/login") {
    signedIn = true;
    // What the real server answers: the session to store, as a header.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        [SESSION_HEADER]: Buffer.from(
          JSON.stringify({
            userId: "faculty",
            password: "secret",
            cookies: [["frmAuth", "ok"]],
            at: Date.now(),
          }),
          "utf-8"
        ).toString("base64url"),
      },
      body: JSON.stringify({ ok: true }),
    });
    return;
  }
  if (path === "/api/logout") {
    signedIn = false;
    await json({ ok: true });
    return;
  }
  if (path === "/api/options") {
    optionsCalls += 1;
    await json(optionsFor(request.postDataJSON() as OptionsRequest));
    return;
  }
  if (path === "/api/register") {
    registerCalls += 1;
    if (registerFails) {
      await json({ error: "Your session has expired." }, 401);
      return;
    }
    // A subject register states its class days in its own grid; the
    // section-wide report aggregates by subject and states none.
    const asked = request.postDataJSON() as RegisterRequest;
    const overall = asked.subject?.value === ALL_SUBJECTS.value;
    await json(registerReply(overall ? null : 6, overall));
    return;
  }
  if (path === "/api/sem-start") {
    semStartCalls += 1;
    await json({ statedFrom: "05/08/2026" });
    return;
  }
  if (path === "/api/sem-absences") {
    semAbsencesCalls += 1;
    await json({ absent: ["05/08", "06/08"] });
    return;
  }
  if (path === "/api/student") {
    const { roll, register } = request.postDataJSON() as StudentRequest;
    profileRolls.push(roll);
    // The All subjects report states no dates, so the panel asks for this
    // student's own grid over the same range; the stub answers as that report
    // would. A subject register's rows already carry their dates, so nothing is
    // asked for.
    const allSubjects = register?.subject?.value === ALL_SUBJECTS.value;
    absentAsked ||= allSubjects;
    await json({
      ...profileFor(roll),
      ...(allSubjects ? { absent: ["02/09"] } : {}),
    });
    return;
  }
  if (path === "/api/find") {
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
    todayCalls += 1;
    // Spans the moment the test runs, so the period is live whenever the
    // clock says it is: the highlight is asserted, not the hour.
    await json(
      todayEmpty
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
            ],
          }
    );
    return;
  }
  if (path === "/api/unposted") {
    unpostedCalls += 1;
    await json({
      date: "24/10/2026",
      reported: true,
      sections: [
        {
          branch: "Information Technology",
          branchShort: "IT",
          semester: "III Semester",
          section: "B",
          cells: [
            { period: "1", posted: true, staff: "Some One" },
            { period: "2", posted: false, staff: "Other Two" },
          ],
        },
        {
          branch: "Computer Science and Engineering (Artificial Intelligence)",
          branchShort: "CSE (AI)",
          semester: "III Semester",
          section: "B",
          cells: [{ period: "1", posted: true, staff: "Third Person" }],
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
async function selectValue(page: Page, label: string): Promise<string | null> {
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
async function signIn(page: Page): Promise<void> {
  await page.getByLabel("ECAP user name").fill("faculty");
  await page.locator('input[type="password"]').fill("secret");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
    .toBe("/home");
}
/** Signed in, with the cascade settled on the stub's first class. Sign-in lands
 *  on Home now, so settling is observed over on the Attendance screen. */
async function signInAndSettle(page: Page): Promise<void> {
  await page.goto("/login");
  await signIn(page);
  await page.getByRole("button", { name: "Attendance" }).click();
  await expect
    .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
    .toBe("ALL SUBJECTS");
}

test.describe("the app's own data layer", () => {
  test.beforeEach(async ({ page }) => {
    signedIn = false;
    sessionCalls = 0;
    optionsCalls = 0;
    registerCalls = 0;
    registerFails = false;
    statedFrom = "";
    semStartCalls = 0;
    semAbsencesCalls = 0;
    profileRolls.length = 0;
    absentAsked = false;
    todayCalls = 0;
    todayEmpty = false;
    unpostedCalls = 0;
    await page.route("**/api/**", stub);
  });
  test("the boot read decides which screen a stranger gets", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      "a dashboard with no session is the sign-in screen"
    ).toBe("/login");
    expect(sessionCalls, "and it was asked, not assumed").toBe(1);
  });
  test("a sign-in settles the whole cascade, one pass per level", async ({
    page,
  }) => {
    await signInAndSettle(page);
    expect(
      {
        course: await selectValue(page, "Course"),
        semester: await selectValue(page, "Semester"),
        branch: await selectValue(page, "Branch"),
        section: await selectValue(page, "Section"),
        subject: await selectValue(page, "Subject"),
      },
      "every level filled itself, in order"
    ).toEqual({
      course: "B.Tech",
      semester: "III Semester",
      branch: "Information Technology",
      section: "IT-3A",
      subject: "ALL SUBJECTS",
    });
    expect(optionsCalls, "a pass per level, and no more").toBe(5);
    expect(registerCalls, "and no register until the click").toBe(0);
  });
  test("the rail names the register screen Attendance", async ({ page }) => {
    await signInAndSettle(page);
    await expect(
      page.getByRole("button", { name: "Attendance" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Dashboard" }),
      "the old name is gone, not duplicated"
    ).toHaveCount(0);
  });
  test("Home is the landing screen and reads today's timetable", async ({
    page,
  }) => {
    await page.goto("/login");
    await signIn(page);
    expect(
      new URL(page.url()).pathname,
      "sign-in lands on Home, not the register"
    ).toBe("/home");
    await expect(
      page.getByRole("heading", { name: "Today's Classes" })
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("columnheader", { name: "Period" }).first(),
      "the timetable's own header, not the unposted table's"
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "AI 3 IT-C" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Period 1" })).toBeVisible();
    // The stubbed period spans now, so its row carries the live tint and the
    // only tint on screen.
    const live = page.locator("tbody tr", { hasText: "AI" });
    await expect(live).toHaveAttribute("style", /blue-light/);
    await expect(page.locator("tbody tr[style*='blue-light']")).toHaveCount(1);
    expect(todayCalls, "one read per opening").toBe(1);
    expect(registerCalls, "and the register waits for its click").toBe(0);
    // Attendance keeps its own screen one tab over.
    await page.getByRole("button", { name: "Home" }).click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 5000 })
      .toBe("/home");
    await page.getByRole("button", { name: "Attendance" }).click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 5000 })
      .toBe("/dashboard");
  });
  test("a cleared day shows one row reading No Classes Today", async ({
    page,
  }) => {
    todayEmpty = true;
    await page.goto("/login");
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Today's Classes" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("No Classes Today", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Period 7", { exact: true })).toHaveCount(0);
    expect(todayCalls, "the row is drawn from one empty read").toBe(1);
  });
  test("Home lists pending postings per branch, all-posted as one line", async ({
    page,
  }) => {
    await page.goto("/login");
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Today's Attendance" })
    ).toBeVisible({ timeout: 15_000 });
    // IT has one pending period: its number, its section, and the staff it
    // waits on — nothing else.
    await expect(page.getByText("Other Two", { exact: true })).toBeVisible();
    await expect(page.getByText("III-B", { exact: true })).toBeVisible();
    await expect(page.getByText("Some One", { exact: true })).toHaveCount(0);
    // CSE (AI) posted everything: one line, no table.
    await expect(page.getByText("All Posted", { exact: true })).toBeVisible();
    expect(unpostedCalls, "one branch read per Home opening").toBe(1);
  });
  test("on a phone the tabs are a bottom bar with no drawer beside them", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // One navigation, not two: the rail is out of the tree, so the bar's
    // Profile is the only one, and the burger that opened a drawer is gone.
    await expect(
      page.getByRole("button", { name: "Profile" }),
      "the rail's copy is hidden on a phone, and the bar's is the whole bar"
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Show the navigation" })
    ).toHaveCount(0);
    const bar = page.locator(".mantine-AppShell-footer");
    await bar.getByRole("button", { name: "Profile" }).click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 5000 })
      .toBe("/profile");
    // Sign out lives in the rail, which a phone does not show: the screen
    // about the signed-in user is where it has to be reachable instead.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 5000 })
      .toBe("/login");
  });
  test("the click is what fetches a register, every time it is clicked", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    // The register is the headed table; the facts tables above it and in the
    // panel have bodies only, so an unscoped row count would include them.
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    expect(registerCalls, "one click, one fetch").toBe(1);
    await expect(
      page.getByRole("row", { name: "Subject ALL SUBJECTS" }),
      "the card names the register it shows"
    ).toBeVisible();
    await expect(
      page.getByRole("row", {
        name: "Date Range 01/07/2026 to 16/10/2026",
      }),
      "the range names the window the class report covered, not the probe's day"
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: "Sem Start Date 05/08/2026" }),
      "the probe's day is the start, on its own row"
    ).toBeVisible();
    // The class report states no count either, so the range stays bare — the
    // probed day names the start but no frame count travels with it.
    await expect(page.getByText("days)")).toHaveCount(0);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect.poll(() => registerCalls, { timeout: 15_000 }).toBe(2);
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
    expect(optionsCalls, "and the click asked for no options").toBe(5);
  });
  test("typing in the search box narrows the register to matches", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    const box = page.getByLabel("Search students by name or roll number");
    await box.fill("21b");
    // The stub's rolls are 21A, 21B, 21C: one row carries that fragment, and
    // the match cannot care that it was typed lower-case.
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(1);
    expect(registerCalls, "filtering reads no portal, it reads the rows").toBe(
      1
    );
    await box.fill("");
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
  });
  test("a search typed for one class goes when the next register loads", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    const box = page.getByLabel("Search students by name or roll number");
    await box.fill("nobody");
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(0);
    await page.getByRole("button", { name: "Load register" }).click();
    // The next register is not the one that name was typed for: a search left
    // behind would hide every row of it with nothing on screen to explain it.
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(box).toHaveValue("");
  });
  test("Student Search shows one roll's attendance and the profile behind it", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Student Search" }).click();
    await page.getByLabel("Roll number").fill("21B");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const panel = page;
    await expect(
      panel.getByText("Overall attendance"),
      "the row ECAP's report states for that roll"
    ).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole("row", { name: "Roll No 21B" })).toBeVisible();
    // The class and the window the figure belongs to are named with it, so a
    // month's figure cannot be read as a semester's — including that the
    // semester itself was inferred rather than stated.
    await expect(panel.getByText(/Section-1/)).toBeVisible();
    await expect(panel.getByText(/I Semester \(inferred\)/)).toBeVisible();
    await expect(panel.getByText("CGPA 5.61")).toBeVisible();
    // One absent list only: the full semester's, with the walked-back start
    // naming it. The month's own list is not beside it.
    await expect(panel.getByText("Absent (1)", { exact: true })).toHaveCount(0);
    await expect(panel.getByText("Absent — full semester (1)")).toBeVisible();
  });
  test("a roll in no section of that class still shows its profile", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Student Search" }).click();
    await page.getByLabel("Roll number").fill("99Z");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const panel = page;
    await expect(
      panel.getByText(/No row for 99Z/),
      "why there is no attendance figure, in words"
    ).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("CGPA 5.61")).toBeVisible();
    await expect(panel.getByText("Overall attendance")).toHaveCount(0);
  });
  test("the search box sits right and fills the width on mobile", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    const box = page.getByLabel("Search students by name or roll number");
    // Viewport-relative on purpose: the row it sits in shrinks to fit, so a
    // ratio against the row is 1 whatever the input does. Polled because a
    // resize has not settled when setViewportSize returns.
    const widthShare = () =>
      box.evaluate((el) => {
        const root = el.closest(".mantine-TextInput-root");
        return (root?.getBoundingClientRect().width ?? 0) / window.innerWidth;
      });
    const offRightEdge = () =>
      box.evaluate((el) => {
        const rect = el
          .closest(".mantine-TextInput-root")
          ?.getBoundingClientRect();
        return window.innerWidth - ((rect?.x ?? 0) + (rect?.width ?? 0));
      });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(widthShare, {
        message: "the box spans a phone screen",
        timeout: 5000,
      })
      .toBeGreaterThan(0.6);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll(widthShare, {
        message: "compact on a wide screen",
        timeout: 5000,
      })
      .toBeLessThan(0.3);
    await expect
      .poll(offRightEdge, {
        message: "against the right edge on a wide screen",
        timeout: 5000,
      })
      .toBeLessThan(60);
    // Narrow enough that the box drops onto its own line: it must still be
    // held against the right edge there, not left on the line.
    await page.setViewportSize({ width: 900, height: 800 });
    await expect
      .poll(offRightEdge, {
        message: "still against the right edge on a narrow laptop",
        timeout: 5000,
      })
      .toBeLessThan(60);
  });
  test("the leave table scrolls inside the page on mobile", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByText("Leaves")).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    // The seven-column table cannot fit a phone: it must scroll inside its
    // own container rather than pushing the whole page sideways. Polled
    // because a resize has not settled when setViewportSize returns.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth
          ),
        { message: "no page-level sideways scroll on a phone", timeout: 5000 }
      )
      .toBeLessThanOrEqual(1);
    // The table itself is wider than the phone: some container between it
    // and the page must scroll, which is what keeps the page itself still.
    await expect
      .poll(
        () =>
          page.getByRole("table").evaluate((table) => {
            let node: HTMLElement | null = table.parentElement;
            while (node && node !== document.body) {
              if (node.scrollWidth > node.clientWidth + 1) return true;
              node = node.parentElement;
            }
            return false;
          }),
        {
          message: "the wide table scrolls inside its container",
          timeout: 5000,
        }
      )
      .toBe(true);
  });
  test("the from input snaps to where the register itself starts", async ({
    page,
  }) => {
    statedFrom = "01/09/2026";
    await signInAndSettle(page);
    // The subject path: the register's own statedFrom is the snap. (On the
    // All subjects path there is none, and the probe's day snaps instead.)
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("MFCS");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(
      page.getByLabel("From"),
      "the input names the day the figures begin on"
    ).toHaveValue("2026-09-01");
    await expect(
      page.getByRole("row", {
        name: /Date Range.*01\/09\/2026 to 16\/10\/2026/,
      }),
      "the range fact agrees with the input it just snapped"
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: /Sem Start Date\s*01\/09\/2026/ }),
      "the register's first day is named on its own row"
    ).toBeVisible();
  });
  test("the All subjects view names one subject's earliest held day", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    // The section-wide report states no dates, so the view probes one
    // subject's own register for its first day — and names that subject.
    await expect(
      page.getByRole("row", { name: "Sem Start Date 05/08/2026" }),
      "the earliest day seen, without naming the probed subject"
    ).toBeVisible();
    expect(semStartCalls, "one probe per register load").toBe(1);
    await expect(
      page.getByLabel("From"),
      "the input snaps to the probed first day"
    ).toHaveValue("2026-08-05");
    // A subject register states its own days, so it probes nothing.
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    expect(semStartCalls, "no probe beside a subject register").toBe(1);
  });
  test("a later window keeps the earliest start day seen", async ({ page }) => {
    statedFrom = "01/09/2026";
    await signInAndSettle(page);
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("MFCS");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(
      page.getByRole("row", { name: /Sem Start Date\s*01\/09\/2026/ }),
      "the first load names its own start"
    ).toBeVisible();
    // A narrower window moves the figures — and the From input with them —
    // but the row keeps the original start the memory holds.
    statedFrom = "01/10/2026";
    await page.getByLabel("From").fill("2026-10-01");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(page.getByLabel("From")).toHaveValue("2026-10-01");
    await expect(
      page.getByRole("row", { name: /Sem Start Date\s*01\/09\/2026/ }),
      "the row keeps the original start, not the window's"
    ).toBeVisible();
  });
  test("a narrowed window still names the full semester's absences", async ({
    page,
  }) => {
    statedFrom = "01/09/2026";
    await signInAndSettle(page);
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("MFCS");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    // Let the From input settle on the register's own start before opening
    // the panel: opening it against the pre-snap window would ask for the
    // wider read the snap then makes unnecessary.
    await expect(page.getByLabel("From")).toHaveValue("2026-09-01");
    const panel = page.getByRole("button", {
      name: "Show details for B student",
    });
    await panel.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("CGPA 5.61")).toBeVisible({
      timeout: 15_000,
    });
    // The snapped window starts at the remembered start, so the window's own
    // list already is the full semester's — shown once, under its name, with
    // no wider read behind it.
    await expect(
      dialog.getByText("Absent — full semester, this subject (1)")
    ).toBeVisible();
    await expect(
      dialog.getByRole("cell", { name: "12/10", exact: true })
    ).toBeVisible();
    expect(
      semAbsencesCalls,
      "no wider read when the window is the semester"
    ).toBe(0);
    await page.getByRole("button", { name: "Close student details" }).click();
    // Narrowing the window asks the wider read, and its answer replaces the
    // window's list rather than joining it.
    statedFrom = "01/10/2026";
    await page.getByLabel("From").fill("2026-10-01");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await panel.click();
    await expect(dialog.getByText("CGPA 5.61")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      dialog.getByRole("cell", { name: "12/10", exact: true }),
      "the window's dates leave with the window's list"
    ).toHaveCount(0);
    await expect(
      dialog.getByText("Absent — full semester, this subject (2)"),
      "the semester's list stands alone"
    ).toBeVisible();
    await expect(
      dialog.getByRole("cell", { name: "05/08", exact: true }),
      "and it holds the semester's absences"
    ).toBeVisible();
    expect(semAbsencesCalls, "one wider read for the open panel").toBe(1);
  });
  test("ticked bars narrow the register, and unticking restores it", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    // Overall figures on the stub: 81, 52, 30. Below 65 keeps two of them.
    await page.getByLabel("Below 65%").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(2);
    await expect(page.getByText("lowest attendance first")).toBeVisible();
    // Below 75 keeps the same two here; ticking it changes nothing further.
    await page.getByLabel("Below 75%").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(2);
    await page.getByLabel("Below 65%").click();
    await page.getByLabel("Below 75%").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
    // The irregular box reads bands, not figures: B and C are flagged.
    await page.getByLabel("All irregular students").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(2);
    await page.getByLabel("All irregular students").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
  });
  test("a subject register shows its own figures alone, table and panel", async ({
    page,
  }) => {
    // The register states its own start, so the snapped window is the whole
    // semester: the window's dates arrive as the one full-semester list.
    statedFrom = "01/07/2026";
    await signInAndSettle(page);
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("columnheader", { name: "Subject Attendance %" })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Overall Attendance %" }),
      "the overall column belongs to the all-subjects view"
    ).toHaveCount(0);
    await expect(
      page.getByRole("row", { name: "Subject MFCS" }),
      "the card names the subject register it shows"
    ).toBeVisible();
    await expect(
      page.getByRole("row", {
        name: "Date Range (108 days) 01/07/2026 to 16/10/2026",
      }),
      "the range carries the calendar-day frame"
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Show details for B student" })
      .click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByText("Subject attendance", { exact: true })
    ).toBeVisible();
    await expect(
      panel.getByText("Overall attendance", { exact: true }),
      "the panel shows the subject figure alone"
    ).toHaveCount(0);
    await expect(
      panel.getByText("Date Range", { exact: false }),
      "the facts table above the register belongs to the register, not the panel"
    ).toHaveCount(0);
    await expect(
      panel.getByText("Absent — full semester, this subject (1)", {
        exact: true,
      }),
      "one list, holding the window's own dates as the semester's"
    ).toBeVisible();
    await expect(
      panel.getByText("12/10", { exact: true }),
      "absence dates are read from the register's own columns, five to a row"
    ).toBeVisible();
    await expect(
      panel.getByText("Backlogs", { exact: true }),
      "the backlogs the profile states are on the panel"
    ).toBeVisible();
    await expect(
      panel.getByRole("row", { name: /I Semester.*Com\.Eng/ }),
      "under the semester ECAP names them by"
    ).toBeVisible();
    await expect(
      panel.getByText("*EP", { exact: true }),
      "with the subject codes it lists, the marked one keeping its asterisk"
    ).toBeVisible();
    await expect(
      panel.getByText("Com.Eng", { exact: true }),
      "every one of them"
    ).toBeVisible();
    await expect(
      panel.getByRole("row", { name: "Total backlogs 2" }),
      "and the page's own total, as it states it"
    ).toBeVisible();
  });
  test("the backlogs sit right after the GPA block", async ({ page }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: "Show details for B student" })
      .click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByText("Backlogs", { exact: true }),
      "the panel states this student's backlogs"
    ).toBeVisible({ timeout: 15_000 });
    // Section order in the drawer: figures, the GPA block, then backlogs —
    // not backlogs trailing the profile at the bottom. Read off the rendered
    // positions, so a change in how Mantine wraps a label cannot move it.
    const top = async (text: string) => {
      const box = await panel.getByText(text, { exact: true }).first();
      const rect = await box.boundingBox();
      return rect?.y ?? Number.NaN;
    };
    const figures = await top("Overall attendance");
    const backlogs = await top("Backlogs");
    const gpa = await top("GPA");
    expect(figures, "the panel states the attendance figures").not.toBeNaN();
    expect(gpa, "the GPA block follows the figures").toBeGreaterThan(figures);
    expect(backlogs, "and backlogs follow the GPA block").toBeGreaterThan(gpa);
  });
  test("a page that says nothing about backlogs gets no backlog section", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: "Show details for A student" })
      .click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("CGPA 5.61")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      panel.getByText("Backlogs", { exact: true }),
      "a page that states nothing about them is not a clean sheet"
    ).toHaveCount(0);
  });
  test("a page that states there are no backlogs says so in its own words", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: "Show details for C student" })
      .click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByText("Student have no backlogs"),
      "the page's own answer is shown, not an empty table"
    ).toBeVisible();
  });
  test("a student's details are read once per open, and not again and again", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    const panel = page.getByRole("button", {
      name: "Show details for B student",
    });
    await panel.click();
    await expect(page.getByText("CGPA 5.61")).toBeVisible({ timeout: 15_000 });
    // ALL SUBJECTS mode, so the Overall row is showing: its figure and band,
    // but not its count — that lives in the table's Attended / Total column.
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("77/148", { exact: true }),
      "the count lives in the table, not the panel"
    ).toHaveCount(0);
    await expect(
      dialog.getByText("52.00%", { exact: true }),
      "the panel keeps the figure and its band"
    ).toBeVisible();
    await expect(
      dialog.getByText("02/09", { exact: true }),
      "the All subjects report states no dates, so the student's own grid answers with them"
    ).toBeVisible();
    expect(
      absentAsked,
      "asked for only because that register is the section-wide one"
    ).toBe(true);
    expect(profileRolls, "one open, one read, for that student").toEqual([
      "21B",
    ]);
    await page.getByRole("button", { name: "Close student details" }).click();
    /* Read straight after the click, because this bug only exists during the
     * slide-out: the panel used to empty itself the moment Close was pressed
     * and then travel off screen bare. */
    expect(
      await page.getByText("CGPA 5.61").isVisible(),
      "the drawer leaves with its content, not empty"
    ).toBe(true);
    await expect(page.getByText("CGPA 5.61")).toBeHidden();
    // Reopening: the last answer is on screen at once and one read lands behind
    // it, which is the whole point of holding it — and then it stops.
    await panel.click();
    await expect(page.getByText("CGPA 5.61")).toBeVisible();
    await expect.poll(() => profileRolls.length, { timeout: 15_000 }).toBe(2);
    await page.waitForTimeout(1000);
    expect(profileRolls, "and it stops there").toEqual(["21B", "21B"]);
    // A different student is a different key: their own read, and only theirs.
    await page.getByRole("button", { name: "Close student details" }).click();
    await page
      .getByRole("button", { name: "Show details for C student" })
      .click();
    await expect
      .poll(() => profileRolls, { timeout: 15_000 })
      .toEqual(["21B", "21B", "21C"]);
  });
  test("a tab that comes back is probed, even just after a deep link in", async ({
    page,
  }) => {
    // The deep link matters: `/dashboard` is where the session hook mounts with
    // focus revalidation already on, and SWR measures its focus window from the
    // mount when the key does not change. Arriving here rather than at `/login`
    // is the case a throttle would swallow.
    await page.goto("/dashboard");
    await signIn(page);
    // Sign-in lands on Home now; the cascade's selects live one tab over.
    await page.getByRole("button", { name: "Attendance" }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    const before = sessionCalls;
    await page.waitForTimeout(500);
    expect(sessionCalls, "an idle session asks nothing by itself").toBe(before);
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    await expect.poll(() => sessionCalls, { timeout: 5000 }).toBe(before + 1);
  });
  test("a 401 ends the session, and nothing of it is left for the next one", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    registerFails = true;
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("alert")).toHaveText(/session expired/i);
    registerFails = false;
    optionsCalls = 0;
    await signIn(page);
    await page.getByRole("button", { name: "Attendance" }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    expect(
      optionsCalls,
      "the new session runs its own cascade from the top"
    ).toBe(5);
    await expect(
      page.locator("tbody tr"),
      "and the previous session's register did not come back with it"
    ).toHaveCount(0);
  });

  test("the session is kept locally, and sign-out drops it", async ({
    page,
  }) => {
    await signInAndSettle(page);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        SESSION_STORE_KEY
      ),
      "sign-in stores the session the server answered"
    ).toBeTruthy();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        SESSION_STORE_KEY
      ),
      "sign-out drops it, and the server keeps no copy to leak"
    ).toBeNull();
  });

  test("a fully chosen class is remembered when Load register is clicked", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.removeItem("section-faculty"));
    await signIn(page);
    await page.getByRole("button", { name: "Attendance" }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(
      page.getByRole("heading", { name: "Saved classes" }),
      "the card appears once the register is loaded"
    ).toBeVisible({ timeout: 5000 });
  });
});
