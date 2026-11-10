import { expect, test } from "@playwright/test";

import {
  resetStub,
  signIn,
  signInAndSettle,
  state,
  stub,
} from "./support/client-stub";

test.describe("the app's own data layer", () => {
  test.beforeEach(async ({ page }) => {
    resetStub();
    await page.route("**/api/**", stub);
  });

  test("the rail names the register screen Register", async ({ page }) => {
    await signInAndSettle(page);
    await expect(
      page.getByRole("button", { name: "Register", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Attendance" }),
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
    // Every slot is named. The free period 3 keeps the hours the grid stated
    // for it — the row reads its hours, not a bare "No Classes Today".
    const free = page.locator("tbody tr", { hasText: "Period 3" });
    await expect(free).toContainText(/\d{1,2}:\d{2}\s*[AP]M/);
    await expect(free).toContainText("No Classes Today");
    // One stated period out of seven slots: the other six read blank.
    await expect(
      page.getByText("No Classes Today", { exact: true })
    ).toHaveCount(6);
    // The stubbed period spans now, so its row carries the live tint and the
    // only tint on screen — a free period never tints, there is nowhere to be.
    const live = page.locator("tbody tr", { hasText: "AI" });
    await expect(live).toHaveAttribute("style", /blue-light/);
    await expect(page.locator("tbody tr[style*='blue-light']")).toHaveCount(1);
    expect(state.todayCalls, "one read per opening").toBe(1);
    expect(state.registerCalls, "and the register waits for its click").toBe(0);
    // The register keeps its own screen one tab over.
    await page.getByRole("button", { name: "Home" }).click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 5000 })
      .toBe("/home");
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 5000 })
      .toBe("/dashboard");
  });

  test("a cleared day keeps the table it stated that morning", async ({
    page,
  }) => {
    await page.goto("/login");
    await signIn(page);
    // The stub states hours for periods 1 and 3; both are learnt on this read.
    await expect(
      page.locator("tbody tr", { hasText: "Period 3" })
    ).toContainText(/\d{1,2}:\d{2}\s*[AP]M/);
    // ECAP clears the day: every slot now states no periods at all — but the
    // morning's own table stays until midnight, not the blank skeleton.
    state.todayEmpty = true;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Today's Classes" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("cell", { name: "AI 3 IT-C" }),
      "the morning's class, not a blank row"
    ).toBeVisible();
    await expect(
      page.getByText("No Classes Today", { exact: true }),
      "every slot but the remembered one"
    ).toHaveCount(6);
    await expect(
      page.locator("tbody tr").filter({ hasText: /\d{1,2}:\d{2}\s*[AP]M/ }),
      "the two slots it was once timed, and no invented hours for the rest"
    ).toHaveCount(2);
  });

  test("a cleared day names every slot, blank ones reading No Classes Today", async ({
    page,
  }) => {
    state.todayEmpty = true;
    await page.goto("/login");
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Today's Classes" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Period 7", { exact: true })).toBeVisible();
    await expect(
      page.getByText("No Classes Today", { exact: true })
    ).toHaveCount(7);
    expect(state.todayCalls, "the rows are drawn from one empty read").toBe(1);
  });

  test("Home lists pending postings per branch, all-posted as one line", async ({
    page,
  }) => {
    await page.goto("/login");
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Today's Attendance" })
    ).toBeVisible({ timeout: 15_000 });
    // The dropdown carries every branch the report named; the first one is
    // chosen by default, so its period boxes render without a click.
    await expect(page.getByRole("combobox")).toBeVisible();
    // Period 1 is posted, period 2 is not: one filled box, the rest empty.
    await expect(page.locator("div[style*='green']")).toHaveCount(1);
    await expect(page.locator("div[style*='gray']")).toHaveCount(6);
    // CSE (AI) posted its only period: choosing it shows one filled box.
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "CSE (AI)" }).click();
    await expect(page.locator("div[style*='green']")).toHaveCount(1);
    await expect(page.locator("div[style*='gray']")).toHaveCount(6);
    expect(state.unpostedCalls, "one branch read per Home opening").toBe(1);
  });

  test("refresh re-reads the home screen without a reload", async ({
    page,
  }) => {
    await page.goto("/login");
    await signIn(page);
    await expect.poll(() => state.todayCalls, { timeout: 15_000 }).toBe(1);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => state.todayCalls, { timeout: 15_000 }).toBe(2);
    await expect.poll(() => state.unpostedCalls, { timeout: 15_000 }).toBe(2);
    expect(new URL(page.url()).pathname, "no reload: still home").toBe("/home");
  });

  test("refresh re-settles the cascade but never the register", async ({
    page,
  }) => {
    await signInAndSettle(page);
    expect(state.optionsCalls, "settle once").toBe(5);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => state.optionsCalls, { timeout: 15_000 }).toBe(6);
    expect(
      state.registerCalls,
      "the click stays the register's only fetch"
    ).toBe(0);
  });

  test("a period box opens whose class it is", async ({ page }) => {
    await page.goto("/login");
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Today's Attendance" })
    ).toBeVisible({ timeout: 15_000 });
    // Period 2 of Section B is unposted: opening its box names the subject,
    // the staff, and the section they belong to — the box itself stays a
    // plain number, details live in the modal alone.
    await page.getByRole("button", { name: "Period 2, Section B" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("SE", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Other Two")).toBeVisible();
    await expect(dialog.getByText("Not posted yet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog, "the modal closes again").toBeHidden();
  });

  test("a posted box opens its headcount beside the class", async ({
    page,
  }) => {
    await page.goto("/login");
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Today's Attendance" })
    ).toBeVisible({ timeout: 15_000 });
    // Period 1 posted with 30 present and 5 absent: the modal pairs the
    // headcount with the class it belongs to.
    await page.getByRole("button", { name: "Period 1, Section B" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("MFCS", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Posted", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("row", { name: /Present\s*30/ })
    ).toBeVisible();
    await expect(dialog.getByRole("row", { name: /Absent\s*5/ })).toBeVisible();
    // The report's own `Roll.No's / Absent Students` column, stated below the
    // facts so a long list wraps instead of becoming a paragraph in half a row.
    await expect(dialog.getByText("Absentees (5)")).toBeVisible();
    await expect(
      dialog.getByText("21B, 21C, 22A, 23B, 24C", { exact: true })
    ).toBeVisible();
  });

  test("a posted box that lists no absentees says so", async ({ page }) => {
    await page.goto("/login");
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "Today's Attendance" })
    ).toBeVisible({ timeout: 15_000 });
    // CSE (AI) posted its one period with nobody missing: the row is there, and
    // it is an answer — "nobody" — rather than a gap the reader must interpret.
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "CSE (AI)" }).click();
    await page.getByRole("button", { name: "Period 1, Section B" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Absentees (0)")).toBeVisible();
    await expect(
      dialog.getByText("None listed", { exact: true })
    ).toBeVisible();
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
    await expect(
      bar.getByRole("button", { name: "Register" }),
      "the bar carries the same name the rail does"
    ).toHaveCount(1);
    expect(
      await bar.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      ),
      "the bar and the gesture area below it paint white"
    ).toBe("rgb(255, 255, 255)");
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
});
