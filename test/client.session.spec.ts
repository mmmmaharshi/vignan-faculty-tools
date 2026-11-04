import { expect, test } from "@playwright/test";

import { SESSION_STORE_KEY } from "../shared/api";
import {
  resetStub,
  selectValue,
  sessionAnswer,
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

  test("the boot read decides which screen a stranger gets", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      "a dashboard with no session is the sign-in screen"
    ).toBe("/login");
    expect(state.sessionCalls, "and it was asked, not assumed").toBe(1);
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
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    const before = state.sessionCalls;
    await page.waitForTimeout(500);
    expect(state.sessionCalls, "an idle session asks nothing by itself").toBe(
      before
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    await expect
      .poll(() => state.sessionCalls, { timeout: 5000 })
      .toBe(before + 1);
  });

  test("a 401 ends the session, and nothing of it is left for the next one", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    state.registerFails = true;
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("alert")).toHaveText(/session expired/i);
    state.registerFails = false;
    state.optionsCalls = 0;
    await signIn(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    expect(
      state.optionsCalls,
      "the new session runs its own cascade from the top"
    ).toBe(5);
    await expect(
      page.locator("tbody tr"),
      "and the previous session's register did not come back with it"
    ).toHaveCount(0);
  });

  test("a session answer landing after sign-out is dropped, not stored", async ({
    page,
  }) => {
    await signInAndSettle(page);
    // A probe already in flight while the user signs out.
    state.hangSession = true;
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect
      .poll(() => state.sessionCalls, { timeout: 15_000 })
      .toBeGreaterThan(2);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        SESSION_STORE_KEY
      ),
      "sign-out clears what the probe has not yet answered"
    ).toBeNull();
    // The held answer lands now, carrying a session to store.
    const held = state.heldSession;
    state.heldSession = null;
    state.hangSession = false;
    const landed = page.waitForResponse("**/api/session", { timeout: 15_000 });
    const answer = sessionAnswer(held?.wasIn ?? false);
    await held?.route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: answer.headers,
      body: answer.body,
    });
    await landed;
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        SESSION_STORE_KEY
      ),
      "a response from before the sign-out must not resurrect it"
    ).toBeNull();
    await page.reload();
    await expect(page.getByLabel("ECAP user name")).toBeVisible({
      timeout: 15_000,
    });
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
});
