import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { ALL_SUBJECTS } from "../shared/api";
import type {
  Option,
  OptionsReply,
  OptionsRequest,
  RegisterReply,
  RegisterRequest,
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
/** What ECAP states for one student. The roll that has nothing is the one the
 *  panel has to say so about. */
const profileFor = (roll: string): StudentProfile => ({
  cgpa: roll === "21C" ? "NA" : "5.61",
  credits: roll === "21C" ? "" : "16/19",
  cgpaPercent: roll === "21C" ? "" : "48.55",
  sgpa: roll === "21C" ? [] : [{ semester: "I Semester", value: "5.61" }],
  phones: roll === "21C" ? [] : [{ label: "Mobile.No", number: "9876543210" }],
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
      persisted: false,
      userId: signedIn ? "faculty" : "",
    });
    return;
  }
  if (path === "/api/login") {
    signedIn = true;
    await json({ ok: true });
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
    .toBe("/dashboard");
}
/** Signed in, with the cascade settled on the stub's first class. */
async function signInAndSettle(page: Page): Promise<void> {
  await page.goto("/login");
  await signIn(page);
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
        name: "Date Range 05/08/2026 to 16/10/2026",
      }),
      "the probe's first day starts the range where the report states none"
    ).toBeVisible();
    // The class report states no count either, so the range stays bare — the
    // probed day names the start but no frame count travels with it.
    await expect(page.getByText("days)")).toHaveCount(0);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect.poll(() => registerCalls, { timeout: 15_000 }).toBe(2);
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
    expect(optionsCalls, "and the click asked for no options").toBe(5);
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
      page.getByText("01/09/2026 to 16/10/2026", { exact: true }),
      "the range fact agrees with the input it just snapped"
    ).toBeVisible();
    await expect(
      page.getByText("01/09/2026", { exact: true }),
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
      page.getByText("01/09/2026", { exact: true }),
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
      page.getByText("01/09/2026", { exact: true }),
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
    // The snapped window starts at the remembered start, so the list on
    // screen already is the full semester — no second list.
    await expect(
      dialog.getByText("Absent — full semester", { exact: false })
    ).toHaveCount(0);
    expect(
      semAbsencesCalls,
      "no wider read when the window is the semester"
    ).toBe(0);
    await page.getByRole("button", { name: "Close student details" }).click();
    // Narrowing the window keeps the window's own list and adds the semester's.
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
    await expect(dialog.getByText("12/10", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("01/10/2026 to 16/10/2026", { exact: true }),
      "the window's list names the window it came from"
    ).toBeVisible();
    await expect(
      dialog.getByText("Absent — full semester (2)"),
      "the semester's list arrives beside it, not instead of it"
    ).toBeVisible();
    await expect(dialog.getByText("05/08", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("01/09/2026 to 16/10/2026", { exact: true }),
      "and it names the remembered start, not the typed one"
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
      panel.getByText("12/10", { exact: true }),
      "absence dates are read from the register's own columns, five to a row"
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

  test("a fully chosen class is remembered when Load register is clicked", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.removeItem("section-faculty"));
    await signIn(page);
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
