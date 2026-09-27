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

const USER = process.env.ECAP_USER;
const PASS = process.env.ECAP_PASS;

/** Mantine renders a Select as an input with a label, not a native <select>. */
function selectInput(page, label) {
  return page.locator("input.mantine-Select-input").filter({
    has: page.locator(`xpath=..//label[normalize-space()="${label}"]`),
  });
}

/** Index of the Select whose label reads exactly `label`. */
async function selectIndex(page, label) {
  return page.evaluate((text) => {
    const inputs = [...document.querySelectorAll("input.mantine-Select-input")];
    return inputs.findIndex((i) => {
      const l = document.querySelector(`label[for="${i.id}"]`);
      return l && l.textContent.replace(/\s*\*$/, "").trim().toLowerCase() === text;
    });
  }, label.toLowerCase());
}

async function selectValue(page, label) {
  return page.evaluate((text) => {
    const inputs = [...document.querySelectorAll("input.mantine-Select-input")];
    const i = inputs.findIndex((inp) => {
      const l = document.querySelector(`label[for="${inp.id}"]`);
      return l && l.textContent.replace(/\s*\*$/, "").trim().toLowerCase() === text;
    });
    return i < 0 ? null : { value: inputs[i].value, disabled: inputs[i].disabled };
  }, label.toLowerCase());
}

/** Open a Select and return its visible options. */
async function openSelect(page, label) {
  const i = await selectIndex(page, label);
  expect(i, `a Select labelled "${label}" should exist`).toBeGreaterThanOrEqual(0);
  await page.locator("input.mantine-Select-input").nth(i).click();
  const options = page.locator('[role="listbox"]:visible [role="option"]');
  await options.first().waitFor({ state: "visible" });
  return options;
}

test.describe("ECAP attendance dashboard", () => {
  test.skip(!USER || !PASS, "set ECAP_USER and ECAP_PASS to run against the live portal");

  test("loads a class register, worst attendance first", async ({ page }) => {
    const problems = [];
    page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
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
        const inputs = [...document.querySelectorAll("input.mantine-Select-input")];
        const i = inputs.findIndex((inp) => {
          const l = document.querySelector(`label[for="${inp.id}"]`);
          return l && l.textContent.replace(/\s*\*$/, "").trim() === "Subject";
        });
        return i >= 0 && !inputs[i].disabled;
      },
      null,
      { timeout: 90_000 },
    );

    // Every level above the subject should now hold a real choice, not just be
    // enabled. An enabled-but-empty dropdown is the exact failure this catches.
    for (const level of ["Course", "Semester", "Branch", "Section"]) {
      const state = await selectValue(page, level);
      expect(state.disabled, `${level} should be enabled`).toBe(false);
      expect(state.value, `${level} should have a value`).not.toBe("");
    }

    /* ---- pick a subject, which is always the user's to choose ---- */
    const subjectOptions = await openSelect(page, "Subject");
    const subject = (await subjectOptions.first().innerText()).trim();
    expect(subject).not.toBe("");
    await page.getByRole("option", { name: subject, exact: true }).click();
    await expect
      .poll(async () => (await selectValue(page, "Subject"))?.value)
      .toBe(subject);

    /* ---- load the register ---- */
    await page.getByLabel("From").fill("2026-06-01");
    await page.getByLabel("To").fill("2026-09-30");
    await page.getByRole("button", { name: "Load register" }).click();

    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 90_000 });

    /* ---- the roster ---- */
    const table = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("tbody tr")].map((tr) => {
        const cells = [...tr.querySelectorAll("td")].map((c) =>
          c.innerText.replace(/\s+/g, " ").trim(),
        );
        const pctText = cells[cells.length - 1] ?? "";
        const num = parseFloat(pctText);
        return {
          roll: cells[1] ?? "",
          name: cells[2] ?? "",
          held: cells[cells.length - 2] ?? "",
          badges: [...tr.querySelectorAll(".mantine-Badge-root")].map((b) =>
            b.textContent.trim().toLowerCase(),
          ),
          pct: Number.isNaN(num) ? null : num,
        };
      });
      return rows;
    });

    expect(table.length, "the register should have rows").toBeGreaterThan(0);

    // Worst first. Checking the ordering rather than a hardcoded count means a
    // real class gaining or losing a student does not turn the suite red, but a
    // broken sort still does.
    const pcts = table.map((r) => r.pct).filter((p) => p != null);
    expect(pcts.length).toBe(table.length, "every row should carry a percentage");
    for (let i = 1; i < pcts.length; i++) {
      expect(
        pcts[i],
        `row ${i} (${pcts[i]}%) should not be worse than the row above it`,
      ).toBeGreaterThanOrEqual(pcts[i - 1]);
    }
    expect(pcts[0], "the worst student should be listed first").toBe(Math.min(...pcts));

    // Rows should look like students, not parse debris.
    for (const row of table.slice(0, 5)) {
      expect(row.roll.length, `roll number should not be empty for ${row.name}`).toBeGreaterThan(0);
      expect(row.held, `attended/held should be populated for ${row.name}`).toMatch(/\d+\s*\/\s*\d+/);
    }

    /* ---- the flagged rows agree with the stat cards ---- */
    // Crosses the wire: the client bands rows, the server counts them, and this
    // is the only assertion that would catch the two disagreeing.
    const flagged = table.filter((r) => r.badges.includes("low") || r.badges.includes("critical"));

    // Each stat card is two siblings: the figure, then the caption. Read the
    // figure from the caption's previous element rather than trying to match
    // both out of one string.
    const statCards = await page.evaluate(() => {
      const out = {};
      for (const p of document.querySelectorAll("p")) {
        const caption = p.textContent.replace(/\s+/g, " ").trim().toUpperCase();
        if (!/^(STUDENTS|CLASS AVERAGE|BELOW \d+%)$/.test(caption)) continue;
        const n = parseInt(p.previousElementSibling?.textContent?.trim() ?? "", 10);
        if (!Number.isNaN(n)) out[caption] = n;
      }
      return out;
    });

    expect(
      statCards["BELOW 75%"],
      `flagged rows (${flagged.length}) should match the Below 75% card, got ${JSON.stringify(statCards)}`,
    ).toBe(flagged.length);

    /* ---- the register on screen is named ---- */
    // With five dropdowns in front of you, reading last week's numbers as this
    // week's is the expensive mistake this line exists to prevent.
    const selection = await page.locator("#selection, p").filter({ hasText: /^Course:/ }).first();
    await expect(selection).toContainText(`Subject: ${subject}`);

    /* ---- nothing exploded on the way ---- */
    expect(problems, `browser reported problems: ${problems.join("; ")}`).toEqual([]);
  });
});
