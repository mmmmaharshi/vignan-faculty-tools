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
 *  - A sign-out survives a restart, which is asserted by reading the OS vault
 *    rather than by asking the server. See "the one test that reads the vault".
 */

import { spawnSync } from "node:child_process";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const STORE_URL = pathToFileURL(
  nodePath.resolve("session-store.ts")
).toString();

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
  // The guard: a deep link to the dashboard while signed out must land on /login
  // rather than flashing the cascade first. Asserted here so every test that signs
  // in also checks it.
  await expect(page.getByLabel("ECAP user name")).toBeVisible();
  expect(
    new URL(page.url()).pathname,
    "guard should send the dashboard to /login"
  ).toBe("/login");

  await page.getByLabel("ECAP user name").fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Signing in navigates, so the URL is the answer to "which screen" now.
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toBe("/dashboard");

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
  await page.goto("/dashboard");
  await submitSignIn(page);
  return loadFirstSubject(page);
}

/**
 * The one test that reads the OS vault, and why it has to.
 *
 * "A sign-out is persisted" is a claim about a **write reaching disk**, and the
 * only honest way to see that is to look at what is on disk. Asserting it from
 * the server's side - asking `/api/session` afterwards, say - would prove nothing:
 * a session removed from the in-memory map and never written still reads as
 * signed-out, so that assertion passes whether or not the write happened. An
 * earlier version of `session-store.spec.ts` made exactly that mistake, calling
 * `saveSessions` twice with a comment saying "what the logout handler writes",
 * and would have gone green with the flush deleted.
 *
 * Read-only, and only this entry. Nothing here writes to the user's real
 * Credential Manager.
 *
 * It shells out to `bun` because the Playwright runner is Node, where `Bun` does
 * not exist. A child process is the honest way to reach a Bun-only API from here
 * rather than pretending the test could ask directly.
 */
function vaultSessions(): { id: string }[] | null {
  // Reads through the store's own `loadSessions`, so the test sees exactly what the
  // server would see rather than a second reading of the vault's layout. The
  // layout is not this test's business and has already changed once.
  const script = [
    `const { bunSecrets, loadSessions } = await import(${JSON.stringify(STORE_URL)});`,
    `const b = bunSecrets();`,
    `if (!b) { console.log("NOVAULT"); process.exit(0); }`,
    `const s = await loadSessions(b);`,
    `console.log(JSON.stringify(s.map((x) => ({ id: x.id }))));`,
  ].join("");
  const out = spawnSync("bun", ["-e", script], { encoding: "utf-8" });
  const text = (out.stdout || "").trim();
  if (text === "NOVAULT") return null;
  if (!text) return [];
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as { id: string }[]) : null;
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
    await page.goto("/dashboard");
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
    expect(url.pathname, "the dashboard is the route").toBe("/dashboard");
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
    expect(
      new URL(page.url()).pathname,
      "reload should stay on the dashboard"
    ).toBe("/dashboard");
  });

  test("every path reaches a screen, and a signed-in one does not loop", async ({
    page,
  }) => {
    // The redirect loop this exists for: the router's catch-all sent `/dashboard`
    // to `/`, the boot guard sent `/` back to `/dashboard`, and the two took turns
    // for ever - 37 navigations and 82 API calls in six seconds, measured.
    //
    // **It only loops while signed in.** Signed out, the guard's first move is
    // `/` to `/login` and it stops there, so a signed-out check passes against the
    // broken build - which is exactly what the first version of this test did. The
    // session is signed in below, and asserted, because a check that cannot see
    // the bug is worse than no check.
    //
    // Counted on the wire rather than from a screenshot: a slow page and a looping
    // page look identical in a snapshot, and the symptom a user sees is a page
    // that never finishes loading rather than an error. Counting *boots* is also
    // wrong - the loop is client-side, so one document load drives hundreds of
    // iterations while `/api/session` is called once, because the boot effect's
    // `booted` guard holds. Request count is what separates the two.
    // A cold load, because `submitSignIn` asserts it was on the sign-in form first
    // and this test starts signed out.
    await page.goto("/dashboard");
    await submitSignIn(page);
    expect(
      new URL(page.url()).pathname,
      "signed in, so the loop below can actually happen"
    ).toBe("/dashboard");

    for (const path of ["/", "/dashboard", "/nonsense"]) {
      let calls = 0;
      const countApi = (req: { url: () => string }) => {
        if (new URL(req.url()).pathname.startsWith("/api/")) calls += 1;
      };
      page.on("request", countApi);
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", { name: "Load register" })
      ).toBeVisible();
      // Let the cascade finish, then check it goes quiet. The loop is a redirect
      // storm, so it keeps working long after the page looks settled.
      await page.waitForTimeout(3000);
      const afterSettle = calls;
      await page.waitForTimeout(3000);
      const later = calls;
      page.off("request", countApi);
      expect(
        later,
        `${path} kept making requests after settling: ${afterSettle} then ${later}`
      ).toBe(afterSettle);
    }

    // And the sign-in form is still reachable for someone who is not signed in.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
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

    await page.goto("/dashboard");
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

    /* ---- the session is a month, and the browser agrees with the server ---- */
    // The cookie's Max-Age is derived from the server's TTL, so the two can never
    // disagree about when a session ends. A month is the point: the ECAP session
    // dies long before this one does, which is why /api/session asks the portal
    // rather than trusting the jar.
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === "ecap_sid");
    expect(sid, "sign-in should set ecap_sid").toBeTruthy();
    // `expires` is an absolute Unix time, not a duration. The difference from now
    // is the cookie's remaining life.
    const days = ((sid?.expires ?? 0) - Date.now() / 1000) / 86_400;
    expect(
      days,
      `ecap_sid should last about 30 days, got ${days.toFixed(1)}`
    ).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    await page.getByLabel("Show only irregular students").click();
    await expect
      .poll(() => page.locator("tbody tr").count())
      .toBeLessThan(total);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible();

    // Signing out deliberately has nothing to explain, so the sign-in form shows
    // no alert at all. Mantine's Alert carries role="alert" by default, so this
    // counts the box itself rather than any text inside it - which is the point,
    // because the bug it guards is an alert with *empty* text. Asserting on text
    // content would pass straight through that.
    await expect(page.getByRole("alert")).toHaveCount(0);

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

  test("a session that dies while you are working says so, and why", async ({
    page,
    request,
  }) => {
    // The other half of the sign-in form's alert, and the only path that sets a
    // note with a reason in it. A deliberate sign-out must stay silent; a dead
    // session must explain itself, or the user is dropped on a form with no idea
    // what happened.
    //
    // Ended from OUTSIDE the browser, so the page still believes it is signed in
    // and has to discover the truth for itself - which is the situation being
    // tested. Deliberately failing a sign-in would reach the same branch but
    // risks an account lockout on a real portal, so it is not done here.
    await signInAndLoad(page);

    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === "ecap_sid");
    expect(sid, "signed in, so there is a session cookie").toBeTruthy();
    await request.post("/api/logout", {
      headers: { cookie: `ecap_sid=${sid?.value}` },
    });

    // The probe also runs on an interval, but waiting five minutes for it is not
    // a test. `visibilitychange` is the same trigger a returning user fires, and
    // the app listens for it directly.
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    );

    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    // The reason, not merely *an* alert: an empty box here is the bug this file
    // has been bitten by before, and it is what `signedOut(why)` guards against.
    await expect(page.getByRole("alert")).toHaveText(/session expired/i);
  });

  test("a sign-out reaches the vault, so a restart cannot undo it", async ({
    page,
    request,
  }) => {
    // The bug this exists for: sign-out only marked the store dirty and left the
    // write to the sixty-second tick. Sign out, hard-kill the server, start it
    // again, and the session was still there - the user ended it and it came back.
    // The signal handlers do not help, because they cover a graceful Ctrl-C and
    // not Task Manager or a power cut.
    await signInAndLoad(page);

    const before = vaultSessions();
    test.skip(before === null, "no OS vault on this runtime");

    // The count is deliberately not asserted. Earlier sessions linger in the
    // vault by design - a second browser stays signed in - so "exactly one" holds
    // only on a clean machine and would fail here for the wrong reason. What
    // matters is whether *this* session is there, and then gone.
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === "ecap_sid");
    expect(sid?.value, "signed in, so there is a session cookie").toBeTruthy();
    expect(
      before?.map((s) => s.id),
      "the session just created must be on disk before we end it"
    ).toContain(sid?.value);

    const res = await request.post("/api/logout", {
      headers: { cookie: `ecap_sid=${sid?.value}` },
    });
    expect(res.ok()).toBe(true);

    // Read the vault again immediately. Nothing is waiting on a timer, so if the
    // session is still here the write did not happen - which is the whole claim.
    const after = vaultSessions();
    expect(
      after?.map((s) => s.id),
      "the ended session must be gone from the vault"
    ).not.toContain(sid?.value);
  });

  test("the session cookie keeps rolling forward while the app is used", async ({
    page,
    baseURL,
  }) => {
    // The server's session slides on every request. The browser's cookie used not
    // to: it was written once at sign-in with a thirty-day Max-Age and never
    // refreshed, so a user who opened the app daily was signed out on day
    // thirty-one anyway. This pins the other half of "the two cannot disagree".
    await signInAndLoad(page);

    const sid = () =>
      page
        .context()
        .cookies()
        .then((cs) => cs.find((c) => c.name === "ecap_sid"));
    const first = await sid();
    expect(
      first?.expires ?? 0,
      "signed in, so there is a cookie"
    ).toBeGreaterThan(0);
    const value = first?.value ?? "";

    // Age the cookie so a re-issue is observable as a change rather than a
    // coincidence of timing. Rewriting what the browser holds is the only way to
    // see a rolling Max-Age from the outside, and it is the browser's own store.
    const aged = Math.floor(Date.now() / 1000) + 60;
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([
        { url: baseURL ?? "", name: "ecap_sid", value, expires: aged },
      ]);

    // Through the **page**, not Playwright's `request` fixture. The fixture keeps
    // its own cookie jar, so a `Set-Cookie` from a request-context response lands
    // in *that* jar and this test would go on reading the page's jar unchanged -
    // green, and proving nothing. The browser is the thing under test.
    const reply = await page.evaluate(async () => {
      const res = await fetch("/api/session");
      return { status: res.status, body: await res.json() };
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ signedIn: true });

    const fresh = await sid();
    expect(
      fresh?.expires ?? 0,
      "an authenticated response must push the expiry back out"
    ).toBeGreaterThan(aged);
  });
});
