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

test.describe("Vignan Faculty Tools", () => {
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

    /* ---- the URL names the screen and carries nothing else ---- */
    // The selection is not in the URL any more - that was ADR 0010 and 0011, both
    // removed by request. What is left is that the path names the screen, and
    // that the app does not leak the selection into the address bar as a side
    // effect of loading a register. Asserted as an absence deliberately: nothing
    // writes the query string, so anything in it would be a regression.
    const url = new URL(page.url());
    expect(url.pathname, "the dashboard is the route").toBe("/dashboard");
    expect(
      [...url.searchParams.keys()],
      "nothing should be written to the query string"
    ).toEqual([]);

    // A reload starts over, because that is what removing the feature means. The
    // subject is gone rather than restored, and the cascade refills from the
    // top - this is the cost of not having a shareable link, pinned so it cannot
    // be reintroduced by accident.
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.locator("input.mantine-Select-input").first()
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => selectState(page, "Subject"), { timeout: 90_000 })
      .toMatchObject({ value: "" });
    expect(
      new URL(page.url()).pathname,
      "reload should stay on the dashboard"
    ).toBe("/dashboard");
  });

  test("the rail has a Dashboard button and a Profile button", async ({
    page,
  }) => {
    // Buttons, because these move between screens inside the app rather than
    // pointing at documents. The screen is still a *path*, and the two facts are
    // asserted separately below: a button is what you click, the URL is what
    // survives a reload. A tab was neither, and lost the second.
    await page.goto("/dashboard");
    await submitSignIn(page);

    const dashboard = page.getByRole("button", { name: "Dashboard" });
    const profile = page.getByRole("button", { name: "Profile" });
    await expect(dashboard).toBeVisible();
    await expect(profile).toBeVisible();
    // The cascade starts on the dashboard, so a user signing in lands where the
    // work is rather than on a profile they did not ask for.
    await expect(page.getByRole("combobox", { name: "Course" })).toBeVisible();
    // Each button carries one icon, and the icon is hidden from assistive tech.
    // Two separate failures, so two assertions: dropping the icon loses the
    // visual cue, and dropping `aria-hidden` leaves a screen reader announcing a
    // graphic next to a label that already says the same thing. The name
    // assertion above cannot see either - an SVG with no title contributes
    // nothing to the accessible name whether it is hidden or not.
    for (const button of [dashboard, profile]) {
      const icon = button.locator("svg");
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    }
    // Exactly one is marked current, and it is the one whose screen is showing.
    // `aria-current` is the accessible half of the active state and
    // `data-variant` is the visible half - `Button` has no `active` prop, so the
    // two are set from `pathname` and could in principle disagree. Asserting
    // both means this fails if the highlight is dropped *or* if it stops
    // matching the screen, which is the bug a hand-rolled variant invites.
    await expect(dashboard).toHaveAttribute("aria-current", "page");
    await expect(profile).not.toHaveAttribute("aria-current", "page");
    await expect(dashboard).toHaveAttribute("data-variant", "filled");
    await expect(profile).toHaveAttribute("data-variant", "subtle");

    await profile.click();
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    // The rail holds navigation and nothing else, so the cascade is not on
    // screen here at all - not beside the profile, not under it.
    await expect(page.getByRole("combobox", { name: "Course" })).toHaveCount(0);
    // And the URL named it, which is the property a tab could not offer.
    expect(new URL(page.url()).pathname).toBe("/profile");
    // The highlight followed the screen rather than sticking to the control that
    // was last pressed. Both are "the profile button" from the DOM's point of
    // view, so only these attributes tell them apart.
    await expect(profile).toHaveAttribute("aria-current", "page");
    await expect(dashboard).not.toHaveAttribute("aria-current", "page");
    await expect(profile).toHaveAttribute("data-variant", "filled");
    await expect(dashboard).toHaveAttribute("data-variant", "subtle");

    await dashboard.click();
    await expect(page.getByRole("combobox", { name: "Course" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profile" })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/dashboard");
    // The selection survived the round trip, because the cascade was never
    // unmounted - it sits above the branch that swaps the screens.
    await expect(dashboard).toHaveAttribute("aria-current", "page");
    await expect(dashboard).toHaveAttribute("data-variant", "filled");

    // A reload stays on the profile. This is the assertion a tab could not make:
    // a tab lives in component state, which a reload throws away.
    await profile.click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(page.url()).pathname, "the profile survives a reload").toBe(
      "/profile"
    );
    await expect(profile).toHaveAttribute("aria-current", "page");
  });

  test("a deep link to the profile is reachable, and reaches the dashboard", async ({
    page,
  }) => {
    // Two guards meet at `/profile`, and either one written wrongly puts the app
    // in a loop or on the wrong screen.
    //
    // Cold, signed out: the boot check must send it to `/login` rather than
    // flash a profile panel for a session that does not exist. Asserted first,
    // because `submitSignIn` asserts it for every other path and this is the one
    // path that is new.
    await page.goto("/profile");
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      "signed out, so the profile is not reachable"
    ).toBe("/login");

    // Cold, signed in: the boot check must NOT redirect `/profile` to
    // `/dashboard`. That redirect is what the old `!onLogin` condition did, and
    // a guard that sends every app path to the dashboard would make the profile
    // un-bookmarkable - the exact reason it is a path.
    await submitSignIn(page);
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible({
      timeout: 30_000,
    });
    expect(
      new URL(page.url()).pathname,
      "the boot guard must leave /profile alone"
    ).toBe("/profile");
  });

  test("the profile says what is stored, and does not invent a name", async ({
    page,
  }) => {
    // ECAP hands us no profile at all: `signIn` checks only that an `frmAuth`
    // cookie appeared. So the panel must show the account id the user typed and
    // the facts this app is authoritative about, and nothing more. Asserted
    // because a plausible-looking invented name is the failure mode here, and it
    // would be the kind that makes every other claim on the screen suspect.
    await page.goto("/dashboard");
    await submitSignIn(page);
    await page.getByRole("button", { name: "Profile" }).click();

    // Scoped to the profile panel: the user name is also in the header, and
    // asserting on the page would pass on either. Which is the point - the panel
    // has to be the one showing it.
    const panel = page.getByRole("heading", { name: "Profile" }).locator("..");
    await expect(panel.getByText(USER, { exact: true })).toBeVisible();
    // The two claims this app can actually back.
    await expect(page.getByText(/credential vault/i)).toBeVisible();
    await expect(page.getByText(/never written to disk/i)).toBeVisible();
    // And the portal's own limit, which is the thing that actually surprises people.
    await expect(page.getByText(/twenty minutes/i)).toBeVisible();
  });

  test("the header carries the app name and nothing else", async ({ page }) => {
    // The name is the first thing a faculty member reads, in two places: the
    // heading and the browser tab. They are stated separately, so nothing enforces
    // they agree - the same shape as the route list that caused the redirect loop.
    // Cheap to pin, so pin it.
    //
    // `level: 3` because that is what the header renders, at the user's request -
    // as an h1 it was by far the loudest thing on a page whose job is a table of
    // student names. The consequence is stated here because it is not visible from
    // the assertion: **the page has no h1 at all.** `Title` takes `order` and
    // `size` separately, so `order={1} size="h3"` would look identical and keep
    // the h1. If this is ever read as an oversight rather than a decision, that
    // prop is the fix.
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { level: 3, name: "Vignan Faculty Tools" })
    ).toBeVisible();
    await expect(page).toHaveTitle("Vignan Faculty Tools");
    // And the subtitle is gone, so the name is not competing with the college
    // name a few pixels under it. Asserted as an absence, because a test that only
    // checks the heading would pass with the subtitle still there.
    await expect(page.getByText("Vignan Institute of Technology")).toHaveCount(
      0
    );
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

    for (const path of ["/", "/dashboard", "/nonsense", "/profile"]) {
      let calls = 0;
      const countApi = (req: { url: () => string }) => {
        if (new URL(req.url()).pathname.startsWith("/api/")) calls += 1;
      };
      await page.goto(path, { waitUntil: "domcontentloaded" });
      // The cascade must reach Subject on its own — that is the loop's whole
      // effect — and with no interaction from us, so the counting below measures
      // the app's traffic rather than a test driving it.
      //
      // `/profile` settles on the profile panel instead: the cascade still runs
      // there (the selection belongs to the session, not the screen) but it is
      // not rendered, so there is no combobox to wait on. It is in the list
      // because it is a path the boot guard has to leave alone, and a guard that
      // redirected it would show up here as traffic that never stops.
      await (path === "/profile"
        ? expect(page.getByRole("heading", { name: "Profile" })).toBeVisible({
            timeout: 90_000,
          })
        : expect(page.getByRole("combobox", { name: "Subject" })).toBeEnabled({
            timeout: 90_000,
          }));
      // Now count, from a page that has settled. Attaching the listener earlier
      // would have included the cascade's own passes, which are *supposed* to
      // happen, and the comparison below could never distinguish them from a loop.
      page.on("request", countApi);
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

  test("the click is the only way a register is ever fetched", async ({
    page,
  }) => {
    // This used to be two tests' worth of rule: a *link* opens the register, a
    // click is not doubled. Both halves belonged to ADR 0011, which is gone with
    // the query string. What survives is simpler and worth more: there is now
    // exactly one path to a register, and it is the button.
    //
    // Counted on the wire rather than by looking at the screen: the thing under
    // test is whether a portal round trip happens, and a table that happens to be
    // on screen cannot tell one request from two. A screen-based version of this
    // would pass with a duplicate fetch still in place.
    const registerCalls: unknown[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/register") && r.method() === "POST") {
        registerCalls.push(r.postData());
      }
    });

    await page.goto("/dashboard");
    await submitSignIn(page);

    // 1. Signing in and watching the cascade fill itself spends no register
    // fetch. Four passes of /api/options happen on the way; a register is not
    // one of them, because nothing has been asked for.
    expect(registerCalls, "the cascade must not fetch a register").toHaveLength(
      0
    );
    await expect(page.locator("tbody tr")).toHaveCount(0);

    // 2. The click fetches it, exactly once, and shows what it asked for.
    const subjectText = await loadFirstSubject(page);
    expect(registerCalls, "one click, one request").toHaveLength(1);
    await expect(
      page.locator("p").filter({ hasText: /^Course:/ })
    ).toContainText(`Subject: ${subjectText}`);

    // 3. Changing a level is the user changing their mind, so nothing is loaded
    // for them. The old register stays on screen; the name line above it is what
    // says it is stale. This is the assertion that would fail if auto-loading
    // were ever reintroduced on the cascade's tail.
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
