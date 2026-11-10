import { expect, test } from "@playwright/test";

import {
  resetStub,
  selectValue,
  signInAndSettle,
  state,
  stub,
} from "./support/client-stub";

test.describe("the dashboard after a reload", () => {
  test.beforeEach(async ({ page }) => {
    resetStub();
    await page.route("**/api/**", stub);
  });

  test("the register that was on screen is still there", async ({ page }) => {
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
      "the rows the page last read are on screen again"
    ).toHaveCount(3, { timeout: 15_000 });
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("MFCS");
    expect(
      state.registerCalls,
      "and a reload does not read the register again"
    ).toBe(1);
  });

  test("a filter ticked before the reload is still ticked", async ({
    page,
  }) => {
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
      "the bar is still ticked"
    ).toBeChecked({ timeout: 15_000 });
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(narrowed);
  });

  test("a session that lapses while the page is closed leaves nothing behind", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    // The tab is closed and the session lapses, so the next boot finds none. That
    // is a session ending without the sign-out button, and the stored view must
    // go with it — otherwise the next person to sign in on this browser opens
    // somebody else's roster, with no Portal call to contradict it.
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

  test("signing out forgets it", async ({ page }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
    await page.reload();
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    // A new session starts on a blank dashboard: the previous session's rows are
    // the Portal's, and they leave with it.
    await signInAndSettle(page);
    await expect(page.locator("thead ~ tbody tr"), "no table").toHaveCount(0);
  });
});
