/**
 * Smoke test: can a faculty member actually load a class register?
 *
 * One end-to-end pass, because every step is a live round trip to the ECAP
 * portal. Splitting it would sign in repeatedly for no extra coverage.
 *
 * Credentials come from ECAP_USER / ECAP_PASS. Without them the suite skips
 * rather than passing vacuously - a green run that checked nothing is worse
 * than no run at all.
 *
 *   bun run build
 *   ECAP_USER=... ECAP_PASS=... bun run test
 *
 * What is asserted, and why each one is worth asserting:
 *
 *  - The cascade populates itself as far as a section. If the auto-advance loop
 *    regresses, the deeper dropdowns stay empty and there is nothing to load.
 *  - Percentages are in ascending order and the first row is the minimum. That is
 *    the entire point of the tool, and it is a property of the rendered output
 *    rather than of any function, so it breaks independently of the code that
 *    produces it.
 *  - The number of flagged rows equals the count the server reported. This
 *    crosses the wire: if the client's banding ever drifts from the server's,
 *    the badge count and the stat card disagree and this fails.
 *  - The line above the table names the register that is actually on screen.
 *  - No console errors or uncaught exceptions for the whole journey.
 */

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Defaulted rather than left undefined, so `test.skip` below is also a type
// narrowing: without the ?? the compiler cannot tell that USER is a string by
// the time the test body fills the field.
const USER = process.env.ECAP_USER ?? "";
const PASS = process.env.ECAP_PASS ?? "";

/**
 * What one cascade Select is currently showing, and where it sits.
 *
 * One function because `page.evaluate` cannot call a helper defined alongside it
 * - the function is serialised into the page - so two lookups meant two copies
 * of the same find, free to drift apart.
 */
type SelectState = { index: number; value: string; disabled: boolean };

/** The Select whose label reads exactly `label`, or null if there is none. */
function selectState(page: Page, label: string): Promise<SelectState | null> {
  return page.evaluate((text) => {
    const inputs = [
      ...document.querySelectorAll<HTMLInputElement>(
        "input.mantine-Select-input"
      ),
    ];
    const index = inputs.findIndex((inp) => {
      const l = document.querySelector(`label[for="${inp.id}"]`);
      return (
        l?.textContent
          .replace(/\s*\*$/, "")
          .trim()
          .toLowerCase() === text
      );
    });
    const input = inputs[index];
    return input
      ? { index, value: input.value, disabled: input.disabled }
      : null;
  }, label.toLowerCase());
}

/** Open a Select and return its visible options. */
async function openSelect(page: Page, label: string): Promise<Locator> {
  const state = await selectState(page, label);
  expect(state, `a Select labelled "${label}" should exist`).not.toBeNull();
  const i = state?.index ?? 0;
  await page.locator("input.mantine-Select-input").nth(i).click();
  const options = page.locator('[role="listbox"]:visible [role="option"]');
  await options.first().waitFor({ state: "visible" });
  return options;
}

/**
 * Fill the sign-in form already on screen and submit it. No navigation.
 *
 * Deliberately separate from `signInAndLoad`: a page load discards React state,
 * and the test that checks a session leaves nothing behind can only observe that
 * if the second sign-in happens in the same document. Anything that wants a
 * cold page uses `signInAndLoad`; anything inspecting leftover state must use
 * this one.
 */
async function submitSignIn(page: Page): Promise<void> {
  // The guard: a deep link to / while signed out must land on /login rather
  // than flashing the cascade first. Asserted here so every test that signs in
  // also checks it.
  await expect(page.getByLabel("ECAP user name")).toBeVisible();
  expect(new URL(page.url()).pathname, "guard should send / to /login").toBe(
    "/login"
  );

  await page.getByLabel("ECAP user name").fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Signing in navigates, so the URL is the answer to "which screen" now.
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toBe("/");

  // Waiting for Subject to unlock waits for the last auto-advance pass.
  await expect
    .poll(
      async () => {
        const state = await selectState(page, "Subject");
        return state?.disabled;
      },
      { timeout: 90_000 }
    )
    .toBe(false);
}

/** Pick the first subject and load its register. Returns the subject's text. */
async function loadFirstSubject(page: Page): Promise<string> {
  const options = await openSelect(page, "Subject");
  const first = await options.first().innerText();
  const subject = first.trim();
  expect(subject).not.toBe("");
  await page.getByRole("option", { name: subject, exact: true }).click();

  await page.getByRole("button", { name: "Load register" }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible({
    timeout: 90_000,
  });
  return subject;
}

/** The whole journey from a cold page: sign in, pick a subject, load a register. */
async function signInAndLoad(page: Page): Promise<string> {
  await page.goto("/");
  await submitSignIn(page);
  return loadFirstSubject(page);
}

test.describe("ECAP attendance dashboard", () => {
  test.skip(
    !USER || !PASS,
    "set ECAP_USER and ECAP_PASS to run against the live portal"
  );

  test("loads a class register, worst attendance first", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
    });

    // The client is the only side still holding each option's title, so the
    // batch number for the section list depends on it going over the wire. A
    // stale read here is invisible on screen - the register still loads - so it
    // is watched directly.
    const optionBodies: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/options") && r.method() === "POST") {
        optionBodies.push(r.postData() ?? "");
      }
    });

    /* ---- sign in ---- */
    await page.goto("/");
    await page.getByLabel("ECAP user name").fill(USER);
    await page.locator('input[type="password"]').fill(PASS);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The chain should fill itself as far as the subject list without the user
    // touching anything. Waiting for Subject to unlock waits for the last pass.
    await page.waitForFunction(
      () => {
        const inputs = [
          ...document.querySelectorAll<HTMLInputElement>(
            "input.mantine-Select-input"
          ),
        ];
        const i = inputs.findIndex((inp) => {
          const l = document.querySelector(`label[for="${inp.id}"]`);
          return l?.textContent.replace(/\s*\*$/, "").trim() === "Subject";
        });
        const input = inputs[i];
        return !!input && !input.disabled;
      },
      null,
      { timeout: 90_000 }
    );

    // Every level above the subject should now hold a real choice, not just be
    // enabled. An enabled-but-empty dropdown is the exact failure this catches.
    for (const level of ["Course", "Semester", "Branch", "Section"]) {
      const state = await selectState(page, level);
      expect(state, `${level} should exist`).not.toBeNull();
      expect(state?.disabled, `${level} should be enabled`).toBe(false);
      expect(state?.value, `${level} should have a value`).not.toBe("");
    }

    /* ---- the batch number has to actually be sent ---- */
    // Once a semester is chosen, its title must appear in the request. A stale
    // closure drops the key entirely, and the server then computes the section
    // list from the semester's value instead. The register still loads, so this
    // is the only place the difference shows.
    const carriedTitle = optionBodies.some((body) => {
      const sent = JSON.parse(body) as {
        semester?: string;
        semesterTitle?: string;
      };
      // A string, not necessarily a non-empty one: IV Semester ships an empty
      // title by design, and the server falls back to the value for that.
      return !!sent.semester && typeof sent.semesterTitle === "string";
    });
    expect(
      carriedTitle,
      `an /api/options request should carry semesterTitle once a semester is chosen; saw ${JSON.stringify(optionBodies)}`
    ).toBe(true);

    /* ---- pick a subject, which is always the user's to choose ---- */
    const subjectOptions = await openSelect(page, "Subject");
    const subjectText = await subjectOptions.first().innerText();
    const subject = subjectText.trim();
    expect(subject).not.toBe("");
    await page.getByRole("option", { name: subject, exact: true }).click();
    await expect
      .poll(async () => {
        const state = await selectState(page, "Subject");
        return state?.value;
      })
      .toBe(subject);

    /* ---- load the register ---- */
    await page.getByLabel("From").fill("2026-06-01");
    await page.getByLabel("To").fill("2026-09-30");
    await page.getByRole("button", { name: "Load register" }).click();

    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 90_000,
    });

    /* ---- the roster ---- */
    const table = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].map((tr) => {
        const cells = [...tr.querySelectorAll("td")].map((c) =>
          c.innerText.replaceAll(/\s+/g, " ").trim()
        );
        const pctText = cells.at(-1) ?? "";
        // The cell renders as "84.44% critical" for a flagged student - the
        // percentage and the badge share it. parseFloat used to stop at the "%"
        // and read 84.44 out of that by accident; Number does not, so the number
        // is pulled out on purpose. The 63-row register has 15 flagged students,
        // and those were exactly the rows this silently lost.
        const num = Number(pctText.match(/[\d.]+/)?.[0] ?? "");
        return {
          roll: cells[1] ?? "",
          name: cells[2] ?? "",
          attendedOfHeld: cells.at(-2) ?? "",
          badges: [...tr.querySelectorAll(".mantine-Badge-root")].map(
            (b) => b.textContent?.trim().toLowerCase() ?? ""
          ),
          pct: Number.isNaN(num) ? null : num,
        };
      })
    );

    expect(table.length, "the register should have rows").toBeGreaterThan(0);

    // Worst first. Checking the ordering rather than a hardcoded count means a
    // real class gaining or losing a student does not turn the suite red, but a
    // broken sort still does.
    const pcts = table.map((r) => r.pct).filter((p): p is number => p != null);
    expect(pcts.length, "every row should carry a percentage").toBe(
      table.length
    );
    for (let i = 1; i < pcts.length; i++) {
      // The loop bound puts both indices in range, so the one assertion below is
      // sound. It is written as an assertion rather than a guard on purpose: a
      // guard that skipped a row would let the suite pass without ever checking
      // it, which is the one failure mode a test must not have.
      // The loop bound puts both indices in range, so the assertion below is
      // sound. It is written as an assertion rather than a guard on purpose: a
      // guard that skipped a row would let the suite pass without ever checking
      // it, which is the one failure mode a test must not have.
      /* oxlint-disable typescript/no-non-null-assertion -- loop bound */
      expect(
        pcts[i],
        `row ${i} (${pcts[i]}%) should not be worse than the row above it`
      ).toBeGreaterThanOrEqual(pcts[i - 1]!);
      /* oxlint-enable typescript/no-non-null-assertion */
    }
    expect(pcts[0], "the worst student should be listed first").toBe(
      Math.min(...pcts)
    );

    // Rows should look like students, not parse debris.
    for (const row of table.slice(0, 5)) {
      expect(
        row.roll.length,
        `roll number should not be empty for ${row.name}`
      ).toBeGreaterThan(0);
      expect(
        row.attendedOfHeld,
        `attended/held should be populated for ${row.name}`
      ).toMatch(/\d+\s*\/\s*\d+/);
    }

    /* ---- the flagged rows agree with the stat cards ---- */
    // Crosses the wire: the client bands rows, the server counts them, and this
    // is the only assertion that would catch the two disagreeing.
    const flagged = table.filter(
      (r) => r.badges.includes("low") || r.badges.includes("critical")
    );

    // Each stat card is two siblings: the figure, then the caption. Read the
    // figure from the caption's previous element rather than trying to match
    // both out of one string.
    const statCards = await page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const p of document.querySelectorAll("p")) {
        const caption = (p.textContent ?? "")
          .replaceAll(/\s+/g, " ")
          .trim()
          .toUpperCase();
        if (!/^(?<card>STUDENTS|CLASS AVERAGE|BELOW \d+%)$/.test(caption)) {
          continue;
        }
        const n = Number(p.previousElementSibling?.textContent?.trim() ?? "");
        if (!Number.isNaN(n)) out[caption] = n;
      }
      return out;
    });

    expect(
      statCards["BELOW 75%"],
      `flagged rows (${flagged.length}) should match the Below 75% card, got ${JSON.stringify(statCards)}`
    ).toBe(flagged.length);

    /* ---- the register on screen is named ---- */
    // With five dropdowns in front of you, reading last week's numbers as this
    // week's is the expensive mistake this line exists to prevent.
    // Mantine Text renders as <p>, so the caption is a paragraph starting with
    // "Course:". No id is set on it, so match on the text itself.
    const selection = page
      .locator("p")
      .filter({ hasText: /^Course:/ })
      .first();
    await expect(selection).toContainText(`Subject: ${subject}`);

    /* ---- nothing exploded on the way ---- */
    expect(
      problems,
      `browser reported problems: ${problems.join("; ")}`
    ).toEqual([]);

    /* ---- the URL is the snapshot, and it survives a reload ---- */
    // The five levels and the date range live in the query string, so a link can
    // be sent to a colleague and a refresh does not throw the selection away.
    // The subject is the hard one: the cascade never auto-fills it, so replaying
    // it is a separate step, and this assertion is really about that.
    const url = new URL(page.url());
    expect(url.pathname, "the dashboard is the route").toBe("/");
    // The URL carries each level's identifier, never its label. The identifier is
    // not asserted here because nothing on screen shows it - the proof is below,
    // where the label comes back, which can only happen if the identifier still
    // matches an option the server is offering.
    for (const key of ["course", "semester", "branch", "section", "subject"]) {
      expect(
        url.searchParams.get(key),
        `${key} should be in the URL`
      ).toBeTruthy();
    }
    expect(url.searchParams.get("subject")).not.toBe(subject);
    expect(url.searchParams.get("from")).toBe("2026-06-01");

    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.locator("input.mantine-Select-input").first()
    ).toBeVisible({
      timeout: 30_000,
    });
    // The subject has to come back on its own, or the link is no use to whoever
    // it was sent to. A label appearing again means the identifier in the URL
    // matched a real option - so this also catches a URL carrying the label.
    await expect
      .poll(
        async () => {
          const state = await selectState(page, "Subject");
          return state?.value;
        },
        { timeout: 90_000 }
      )
      .toBe(subject);
    expect(new URL(page.url()).pathname, "reload should stay on /").toBe("/");
  });

  test("a link opens the register, and arriving by hand does not", async ({
    page,
  }) => {
    // The rule: a *link* is followed, a click is not doubled. Someone who
    // arrives with a subject in the URL came from a link or a refresh, and wants
    // the register rather than an empty table to click. Someone who picks a
    // subject from a dropdown is making a choice now, and `Load register` is the
    // click they make it with.
    //
    // Asserted by counting the requests, not by looking at the screen: the thing
    // under test is whether a portal round trip happens, and a table that happens
    // to be on screen does not distinguish one request from two.
    const registerCalls: unknown[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/register") && r.method() === "POST") {
        registerCalls.push(r.postData());
      }
    });

    await page.goto("/");
    await submitSignIn(page);

    // Arrived with no subject in the URL, so nothing should have been loaded.
    expect(registerCalls, "arriving by hand must not auto-load").toHaveLength(
      0
    );
    await expect(page.locator("tbody tr")).toHaveCount(0);

    // Assemble a link by hand, the way a user would.
    const subjectText = await loadFirstSubject(page);
    expect(registerCalls).toHaveLength(1);
    const link = page.url();

    // 1. Following the link opens the register with no click at all.
    registerCalls.length = 0;
    await page.goto(link, { waitUntil: "networkidle" });
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 90_000,
    });
    expect(registerCalls, "a link should open the register once").toHaveLength(
      1
    );
    await expect(
      page.locator("p").filter({ hasText: /^Course:/ })
    ).toContainText(`Subject: ${subjectText}`);

    // 2. Reloading the same link must not send a second request. This is the
    // one that catches a ref being cleared after the call rather than before it.
    registerCalls.length = 0;
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 90_000,
    });
    await page.waitForTimeout(1500);
    expect(registerCalls, "a reload should not double-load").toHaveLength(1);

    // 3. Changing a level is the user changing their mind, so nothing is loaded
    // for them. The old register stays on screen; the name line above it is what
    // says it is stale.
    registerCalls.length = 0;
    const branch = page.getByRole("combobox", { name: "Branch" });
    const before = await branch.inputValue();
    await branch.click();
    const options = page.locator('[role="listbox"]:visible [role="option"]');
    await options.first().waitFor({ state: "visible" });
    const allOptions = await options.all();
    for (const opt of allOptions) {
      const raw = await opt.innerText();
      const text = raw.trim();
      if (text && text !== before) {
        await opt.click();
        break;
      }
    }
    await page.waitForTimeout(4000);
    expect(registerCalls, "changing a level must not auto-load").toHaveLength(
      0
    );
  });

  test("ending a session leaves nothing of it behind", async ({ page }) => {
    // A dead session used to change the screen and keep the state: signing back
    // in produced a table already narrowed by a filter ticked against the
    // session that no longer existed. "Sign out" reaches the same function as
    // the 401 path, so this holds the clearing for both - a 401 cannot be
    // provoked from inside one run, because the suite's own server would have
    // to be restarted mid-test.
    await signInAndLoad(page);
    const total = await page.locator("tbody tr").count();
    expect(total).toBeGreaterThan(0);

    await page.getByLabel("Show only irregular students").click();
    await expect
      .poll(() => page.locator("tbody tr").count())
      .toBeLessThan(total);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible();

    // Sign in again in the SAME document. A page load would discard React state
    // and the test would pass whatever signedOut did or did not clear, which is
    // the mistake this test exists to prevent.
    await submitSignIn(page);

    // Checked before loading anything, because a fresh register would overwrite
    // the stale one and hide it: no register has been asked for in this session
    // yet, so none should be on screen.
    await expect(page.locator("tbody tr")).toHaveCount(0);

    await loadFirstSubject(page);

    // Unticked, unfiltered, and the full class back - not the previous
    // session's view of it.
    await expect(
      page.getByLabel("Show only irregular students")
    ).not.toBeChecked();
    await expect(page.locator("tbody tr")).toHaveCount(total);
  });
});
