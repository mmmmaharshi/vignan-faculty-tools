import { expect, test } from "@playwright/test";

import {
  profileRolls,
  resetStub,
  selectValue,
  signInAndSettle,
  state,
  stub,
  totalsAsked,
} from "./support/client-stub";

test.describe("the app's own data layer", () => {
  test.beforeEach(async ({ page }) => {
    resetStub();
    await page.route("**/api/**", stub);
  });

  test("a student panel states the semester's held, attended and absent classes", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: /Show details for/ })
      .first()
      .click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByText("Semester classes", { exact: true }),
      "the counts sit under their own heading"
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      panel.getByRole("row", { name: /Total Held\s*21/ })
    ).toBeVisible();
    // The month table states ECAP's own cumulative figure per month, so a
    // counselling report quotes the Portal rather than this app's arithmetic.
    await expect(
      panel.getByText(
        /Attendance by month \(cumulative from the semester start, all subjects\)/
      )
    ).toBeVisible();
    await expect(
      panel.getByRole("row", {
        name: /05\/08\/2026 to 31\/08\/2026\s*65\.00%/,
      }),
      "the first month opens where the semester did"
    ).toBeVisible();
    await expect(
      panel.getByRole("row", {
        name: /01\/09\/2026 to 30\/09\/2026\s*75\.50%/,
      }),
      "and the next month starts on its own first day"
    ).toBeVisible();
    await expect(
      panel.getByRole("row", { name: /Total Attend\s*21/ })
    ).toBeVisible();
    await expect(
      panel.getByRole("row", { name: /Total Absent\s*0/ })
    ).toBeVisible();
    expect(
      totalsAsked,
      "asked from the semester start, never from the window"
    ).not.toEqual([]);
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

  test("a narrowed window still names the full semester's absences", async ({
    page,
  }) => {
    state.statedFrom = "01/09/2026";
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
      state.semAbsencesCalls,
      "no wider read when the window is the semester"
    ).toBe(0);
    await page.getByRole("button", { name: "Close student details" }).click();
    // Narrowing the window asks the wider read, and its answer replaces the
    // window's list rather than joining it.
    state.statedFrom = "01/10/2026";
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
    expect(state.semAbsencesCalls, "one wider read for the open panel").toBe(1);
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

  test("a semester row opens its subject grades in a modal", async ({
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
    await panel.getByRole("button", { name: "I Semester" }).click();
    const modal = page.getByRole("dialog", {
      name: "I Semester — subject grades",
    });
    await expect(modal.getByRole("row", { name: /LAC\s*E/ })).toBeVisible();
    await expect(modal.getByRole("row", { name: /EP\s*F/ })).toBeVisible();
    await page.getByRole("button", { name: "Close subject grades" }).click();
    await expect(modal).toBeHidden();
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
      state.absentAsked,
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
});
