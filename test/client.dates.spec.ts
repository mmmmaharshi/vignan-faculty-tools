import { expect, test } from "@playwright/test";

import {
  resetStub,
  selectValue,
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

  test("the From input opens at the walked semester start, not the month", async ({
    page,
  }) => {
    state.semStartWalkFrom = "20/06/2026";
    await page.goto("/login");
    await signIn(page);
    // Sign-in settles the cascade, and the settled class has no remembered
    // start, so the walk fires behind the landing screen and From opens at
    // its answer instead of the first of the month.
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      page.getByLabel("From"),
      "From opens at the walked start"
    ).toHaveValue("2026-06-20", { timeout: 15_000 });
    expect(state.walkCalls, "one walk per settled class without a memory").toBe(
      1
    );
  });

  test("a remembered start opens From with no walk at all", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    // The All subjects load teaches the memory through its post-load probe;
    // MFCS is the first subject offered, so the memory lands under its key.
    await expect(
      page.getByRole("row", { name: "Sem Start Date 05/08/2026" })
    ).toBeVisible({ timeout: 15_000 });
    expect(state.walkCalls, "the unknown class walked once").toBe(1);
    // A date typed by hand stands — then switching to the known subject
    // snaps From back to its remembered start, asking ECAP nothing.
    await page.getByLabel("From").fill("2026-10-01");
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await expect(
      page.getByLabel("From"),
      "From opens at the memory"
    ).toHaveValue("2026-08-05", { timeout: 15_000 });
    expect(state.walkCalls, "no second walk for a known class").toBe(1);
  });
  // `exact` on the tab's own name: the same screen's "Load register" answers
  // to the substring, so an inexact locator is two buttons.

  test("the from input snaps to where the register itself starts", async ({
    page,
  }) => {
    state.statedFrom = "01/09/2026";
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
    expect(state.semStartCalls, "one probe per register load").toBe(1);
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
    expect(state.semStartCalls, "no probe beside a subject register").toBe(1);
  });

  test("a later window keeps the earliest start day seen", async ({ page }) => {
    state.statedFrom = "01/09/2026";
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
    state.statedFrom = "01/10/2026";
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

  test("Load register waits for the settle-time walk, so the first load is Till Now", async ({
    page,
  }) => {
    state.hangWalk = true;
    state.semStartWalkFrom = "05/08/2026";
    await page.goto("/login");
    await signIn(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    // The month window is still on screen, but Load must not take it: the
    // semester start has not answered yet.
    await expect(
      page.getByText("Finding the semester start", { exact: false })
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByRole("button", { name: "Load register" })
      .click({ force: true });
    expect(
      state.registerCalls,
      "no register goes out before the start is known"
    ).toBe(0);
    const held = state.heldWalk;
    state.heldWalk = null;
    state.hangWalk = false;
    expect(held, "the walk was asked").not.toBeNull();
    await held?.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ statedFrom: state.semStartWalkFrom }),
    });
    await expect(page.getByLabel("From")).toHaveValue("2026-08-05", {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    expect(state.lastRegisterFrom, "the load opens at the walked start").toBe(
      "05/08/2026"
    );
  });

  test("a hand-typed range loads at once, without waiting for the walk", async ({
    page,
  }) => {
    state.hangWalk = true;
    state.semStartWalkFrom = "05/08/2026";
    await page.goto("/login");
    await signIn(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    await expect(
      page.getByText("Finding the semester start", { exact: false })
    ).toBeVisible({ timeout: 15_000 });
    // The typed range needs no probe: the gate lifts for it at once.
    await page.getByLabel("From").fill("2026-09-01");
    await expect(
      page.getByText("Finding the semester start", { exact: false })
    ).toHaveCount(0);
    // The typed range lifted the gate: a normal click loads it at once.
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    expect(state.lastRegisterFrom, "the typed range wins over the walk").toBe(
      "01/09/2026"
    );
    const held = state.heldWalk;
    state.heldWalk = null;
    state.hangWalk = false;
    expect(held, "the walk was asked").not.toBeNull();
    await held?.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ statedFrom: state.semStartWalkFrom }),
    });
  });

  test("editing only To keeps the gate: From is still unsettled", async ({
    page,
  }) => {
    state.hangWalk = true;
    state.semStartWalkFrom = "05/08/2026";
    await page.goto("/login");
    await signIn(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    await expect(
      page.getByText("Finding the semester start", { exact: false })
    ).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("To").fill("2026-08-31");
    await page
      .getByRole("button", { name: "Load register" })
      .click({ force: true });
    expect(
      state.registerCalls,
      "a typed To alone must not take the unsettled From"
    ).toBe(0);
    const held = state.heldWalk;
    state.heldWalk = null;
    state.hangWalk = false;
    expect(held, "the walk was asked").not.toBeNull();
    await held?.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ statedFrom: state.semStartWalkFrom }),
    });
  });
});
