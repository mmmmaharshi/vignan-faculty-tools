import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { resetStub, signInAndSettle, state, stub } from "./support/client-stub";

/** The old dashboard view key, checked here so nothing starts storing rows again. */
const storedView = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    const raw = localStorage.getItem("dashboard-view");
    return raw === null ? null : JSON.parse(raw);
  });

test.describe("the dashboard after a reload", () => {
  test.beforeEach(async ({ page }) => {
    resetStub();
    await page.route("**/api/**", stub);
  });

  test("a reload starts with an empty dashboard and reads nothing again", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    expect(state.registerCalls, "one load, on the click").toBe(1);

    await page.reload();

    await expect(
      page.locator("thead ~ tbody tr"),
      "no roster is put back by a reload"
    ).toHaveCount(0, { timeout: 15_000 });
    expect(
      state.registerCalls,
      "and a reload does not read the register again"
    ).toBe(1);
    expect(
      await storedView(page),
      "no student rows are kept in the browser"
    ).toBeNull();
  });

  test("a failed boot lands on the form with no roster to restore", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    expect(await storedView(page), "the roster is never written").toBeNull();

    // ECAP unreachable at the next boot: both probes fail, so the app lands on
    // the form. Nothing from the last session is left in the browser for the
    // next person, sign-in or no sign-in.
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "down" }),
      })
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(await storedView(page)).toBeNull();
  });

  test("a filter ticked before the reload is gone", async ({ page }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page.getByLabel("All irregular students").click();
    const narrowed = await page.locator("thead ~ tbody tr").count();
    expect(narrowed, "the bar narrows the roster").toBeLessThan(3);

    await page.reload();

    await expect(
      page.getByLabel("All irregular students"),
      "no bar is carried into a new load — it belongs to a table that is gone"
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(0);
  });

  test("a session that lapses while the page is closed leaves nothing behind", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    // The tab is closed and the session lapses, so the next boot finds none.
    state.signedIn = false;
    await page.reload();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
    await signInAndSettle(page);
    await expect(
      page.locator("thead ~ tbody tr"),
      "the new session starts on a blank dashboard"
    ).toHaveCount(0);
  });

  test("signing out leaves no dashboard view behind", async ({ page }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
    expect(
      await storedView(page),
      "no view was stored at any point"
    ).toBeNull();
    await page.reload();
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    await signInAndSettle(page);
    await expect(page.locator("thead ~ tbody tr"), "no table").toHaveCount(0);
  });
});
