import { spawnSync } from "node:child_process";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const STORE_URL = pathToFileURL(
  nodePath.resolve("session-store.ts")
).toString();
const USER = process.env.ECAP_USER ?? "";
const PASS = process.env.ECAP_PASS ?? "";
type SelectState = { index: number; value: string; disabled: boolean };
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
async function openSelect(page: Page, label: string): Promise<Locator> {
  const state = await selectState(page, label);
  expect(state, `a Select labelled "${label}" should exist`).not.toBeNull();
  const i = state?.index ?? 0;
  await page.locator("input.mantine-Select-input").nth(i).click();
  const options = page.locator('[role="listbox"]:visible [role="option"]');
  await options.first().waitFor({ state: "visible" });
  return options;
}
async function submitSignIn(page: Page): Promise<void> {
  await expect(page.getByLabel("ECAP user name")).toBeVisible();
  expect(
    new URL(page.url()).pathname,
    "guard should send the dashboard to /login"
  ).toBe("/login");
  await page.getByLabel("ECAP user name").fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
    .toBe("/dashboard");
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
async function signInAndLoad(page: Page): Promise<string> {
  await page.goto("/dashboard");
  await submitSignIn(page);
  return loadFirstSubject(page);
}
function vaultSessions(): { id: string }[] | null {
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
    const optionBodies: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/options") && r.method() === "POST") {
        optionBodies.push(r.postData() ?? "");
      }
    });
    await page.goto("/dashboard");
    await page.getByLabel("ECAP user name").fill(USER);
    await page.locator('input[type="password"]').fill(PASS);
    await page.getByRole("button", { name: "Sign in" }).click();
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
    for (const level of ["Course", "Semester", "Branch", "Section"]) {
      const state = await selectState(page, level);
      expect(state, `${level} should exist`).not.toBeNull();
      expect(state?.disabled, `${level} should be enabled`).toBe(false);
      expect(state?.value, `${level} should have a value`).not.toBe("");
    }
    const carriedTitle = optionBodies.some((body) => {
      const sent = JSON.parse(body) as {
        semester?: string;
        semesterTitle?: string;
      };
      return !!sent.semester && typeof sent.semesterTitle === "string";
    });
    expect(
      carriedTitle,
      `an /api/options request should carry semesterTitle once a semester is chosen; saw ${JSON.stringify(optionBodies)}`
    ).toBe(true);
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
    await page.getByLabel("From").fill("2026-06-01");
    await page.getByLabel("To").fill("2026-09-30");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 90_000,
    });
    const table = await page.evaluate(() => {
      const head = [...document.querySelectorAll("thead th")].map((th) =>
        (th.textContent ?? "").replaceAll(/\s+/g, " ").trim()
      );
      const at = (name: string): number => head.indexOf(name);
      const pctIdx = at("Subject Attendance %");
      const heldIdx = at("Attend / Held");
      return [...document.querySelectorAll("tbody tr")].map((tr) => {
        const cells = [...tr.querySelectorAll("td")];
        const num = (i: number): number | null => {
          const found = Number(
            (cells[i]?.textContent ?? "").match(/[\d.]+/)?.[0] ?? ""
          );
          return Number.isNaN(found) ? null : found;
        };
        const text = (i: number): string =>
          (cells[i]?.textContent ?? "").replaceAll(/\s+/g, " ").trim();
        // Badges come from the subject cell only: the row also carries the
        // overall badge, and this card counts the subject one.
        const pctCell = cells[pctIdx];
        return {
          roll: text(1),
          name: text(2),
          attendedOfHeld: text(heldIdx),
          pct: num(pctIdx),
          badges: [...(pctCell?.querySelectorAll(".mantine-Badge-root") ?? [])]
            .map((b) => b.textContent?.trim().toLowerCase() ?? "")
            .filter(Boolean),
        };
      });
    });
    expect(table.length, "the register should have rows").toBeGreaterThan(0);
    const pcts = table.map((r) => r.pct).filter((p): p is number => p != null);
    expect(pcts.length, "every row should carry a percentage").toBe(
      table.length
    );
    for (let i = 1; i < pcts.length; i++) {
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
    const flagged = table.filter(
      (r) => r.badges.includes("low") || r.badges.includes("critical")
    );
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
    const selection = page
      .locator("p")
      .filter({ hasText: /^Course:/ })
      .first();
    await expect(selection).toContainText(`Subject: ${subject}`);
    expect(
      problems,
      `browser reported problems: ${problems.join("; ")}`
    ).toEqual([]);
    const url = new URL(page.url());
    expect(url.pathname, "the dashboard is the route").toBe("/dashboard");
    expect(
      [...url.searchParams.keys()],
      "nothing should be written to the query string"
    ).toEqual([]);
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
    await page.goto("/dashboard");
    await submitSignIn(page);
    const dashboard = page.getByRole("button", { name: "Dashboard" });
    const profile = page.getByRole("button", { name: "Profile" });
    await expect(dashboard).toBeVisible();
    await expect(profile).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Course" })).toBeVisible();
    for (const button of [dashboard, profile]) {
      const icon = button.locator("svg");
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    }
    await expect(dashboard).toHaveAttribute("aria-current", "page");
    await expect(profile).not.toHaveAttribute("aria-current", "page");
    await expect(dashboard).toHaveAttribute("data-variant", "filled");
    await expect(profile).toHaveAttribute("data-variant", "subtle");
    await profile.click();
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Course" })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/profile");
    await expect(profile).toHaveAttribute("aria-current", "page");
    await expect(dashboard).not.toHaveAttribute("aria-current", "page");
    await expect(profile).toHaveAttribute("data-variant", "filled");
    await expect(dashboard).toHaveAttribute("data-variant", "subtle");
    await dashboard.click();
    await expect(page.getByRole("combobox", { name: "Course" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profile" })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/dashboard");
    await expect(dashboard).toHaveAttribute("aria-current", "page");
    await expect(dashboard).toHaveAttribute("data-variant", "filled");
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

  test("the rail holds the sign-out, and the header does not", async ({
    page,
  }) => {
    // Sign out and the user name moved out of the header and into the rail. The
    // header is the burger and the title now, and a control that belongs to the
    // navigation sitting above the navigation is a control nobody looks for.
    //
    // Scoped by ARIA landmark role rather than by CSS class. `AppShell.Navbar`
    // renders a `<nav>` and `AppShell.Header` a `<header>`, so these are real
    // landmarks - and Mantine's own class names are hashed (`m_45252eee` and
    // friends), which would make a `.mantine-AppShell-navbar` selector match
    // nothing at all and fail for the wrong reason.
    //
    // The point of the test is *which* region a control is in, so an unscoped
    // assertion would pass with the button back in the header.
    await page.goto("/dashboard");
    await submitSignIn(page);

    const rail = page.getByRole("navigation");
    await expect(rail.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(rail.getByText(USER, { exact: true })).toBeVisible();

    // And the header is empty of them, asserted as an absence so this fails if
    // the move is half-reverted.
    const header = page.getByRole("banner");
    await expect(header.getByRole("button", { name: "Sign out" })).toHaveCount(
      0
    );
    await expect(header.getByText(USER, { exact: true })).toHaveCount(0);
    // What is left in the header is the app name, which is the point of a header.
    await expect(
      header.getByRole("heading", { name: "Vignan Faculty Tools" })
    ).toBeVisible();

    // Still works from where it now lives.
    await rail.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
  });

  test("a deep link to the profile is reachable, and reaches the dashboard", async ({
    page,
  }) => {
    await page.goto("/profile");
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    expect(
      new URL(page.url()).pathname,
      "signed out, so the profile is not reachable"
    ).toBe("/login");
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
    await page.goto("/dashboard");
    await submitSignIn(page);
    await page.getByRole("button", { name: "Profile" }).click();
    const panel = page.getByRole("heading", { name: "Profile" }).locator("..");
    await expect(panel.getByText(USER, { exact: true })).toBeVisible();
    await expect(page.getByText(/credential vault/i)).toBeVisible();
    await expect(page.getByText(/never written to disk/i)).toBeVisible();
    await expect(page.getByText(/twenty minutes/i)).toBeVisible();
  });
  test("the header carries the app name and nothing else", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { level: 3, name: "Vignan Faculty Tools" })
    ).toBeVisible();
    await expect(page).toHaveTitle("Vignan Faculty Tools");
    await expect(page.getByText("Vignan Institute of Technology")).toHaveCount(
      0
    );
  });
  test("every student carries an overall figure beside the subject one", async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
    await page.goto("/dashboard");
    await submitSignIn(page);
    const subjectOptions = await openSelect(page, "Subject");
    const firstOption = await subjectOptions.first().innerText();
    const subject = firstOption.trim();
    await page.getByRole("option", { name: subject, exact: true }).click();
    await page.getByLabel("From").fill("2026-06-01");
    await page.getByLabel("To").fill("2026-09-30");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 90_000,
    });
    const head = await page.evaluate(() =>
      [...document.querySelectorAll("thead th")].map((th) =>
        (th.textContent ?? "").replaceAll(/\s+/g, " ").trim()
      )
    );
    expect(head).toContain("Overall Attendance %");
    // The subject columns must still be there: this is the subject path.
    expect(head).toContain("Attend / Held");
    expect(head).toContain("Subject Attendance %");
    // The raw all-classes count belongs to the all-subjects view only.
    expect(head).not.toContain("Attended / All Classes");
    const overallPctIdx = head.indexOf("Overall Attendance %");
    const overalls = await page.evaluate((pct) => {
      const rows = [...document.querySelectorAll("tbody tr")];
      const cells = [...rows].map(
        (tr) => [...tr.querySelectorAll("td")] as Element[]
      );
      return {
        rows: rows.length,
        filled: cells.filter((c) => /\d/.test(c[pct]?.textContent ?? ""))
          .length,
        badged: cells.filter(
          (c) =>
            (c[pct]?.querySelectorAll(".mantine-Badge-root").length ?? 0) > 0
        ).length,
      };
    }, overallPctIdx);
    expect(overalls.rows, "the register should have rows").toBeGreaterThan(0);
    expect(
      overalls.filled,
      "the real portal should give every student an overall percentage"
    ).toBeGreaterThan(0);
    expect(
      overalls.badged,
      "beside a subject the overall figure carries no badge of its own"
    ).toBe(0);
    expect(
      problems,
      `no uncaught errors; got ${JSON.stringify(problems)}`
    ).toHaveLength(0);
  });
  test("all subjects shows the class overall, and the cards count it", async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
    await page.goto("/dashboard");
    await submitSignIn(page);
    const options = await openSelect(page, "Subject");
    await expect(options.getByRole("option")).not.toHaveCount(1);
    await page
      .getByRole("option", { name: "All subjects", exact: true })
      .click();
    await expect
      .poll(async () => {
        const state = await selectState(page, "Subject");
        return state?.value;
      })
      .toBe("All subjects");
    await page.getByLabel("From").fill("2026-06-01");
    await page.getByLabel("To").fill("2026-09-30");
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 90_000,
    });
    const state = await page.evaluate(() => {
      const head = [...document.querySelectorAll("thead th")].map((th) =>
        (th.textContent ?? "").replaceAll(/\s+/g, " ").trim()
      );
      const rows = [...document.querySelectorAll("tbody tr")];
      const overallIdx = head.indexOf("Overall Attendance %");
      const cellIdx = head.indexOf("Attended / All Classes");
      const cells = [...rows].map(
        (tr) => [...tr.querySelectorAll("td")] as Element[]
      );
      const flagged = rows.filter((tr) =>
        [...tr.querySelectorAll(".mantine-Badge-root")].some((b) => {
          const text = b.textContent?.trim().toLowerCase();
          return text === "low" || text === "critical";
        })
      ).length;
      const cards: Record<string, string> = {};
      for (const p of document.querySelectorAll("p")) {
        const caption = (p.textContent ?? "")
          .replaceAll(/\s+/g, " ")
          .trim()
          .toUpperCase();
        if (caption.includes("OVERALL")) {
          cards[caption] = (p.previousElementSibling?.textContent ?? "").trim();
        }
      }
      return {
        head,
        rows: rows.length,
        bothNumbers: cells.filter((c) =>
          /^\d+\s*\/\s*\d+$/.test((c[cellIdx]?.textContent ?? "").trim())
        ).length,
        withOverall: rows.filter((tr) =>
          /\d/.test(tr.querySelectorAll("td")[overallIdx]?.textContent ?? "")
        ).length,
        flagged,
        cards,
      };
    });
    expect(
      state.head,
      "subject columns are gone with no subject chosen"
    ).not.toContain("Attend / Held");
    expect(state.head).not.toContain("Subject Attendance %");
    expect(state.head).toContain("Overall Attendance %");
    expect(state.head).toContain("Attended / All Classes");
    expect(state.rows).toBeGreaterThan(0);
    expect(
      state.bothNumbers,
      "every student should show attended over all classes"
    ).toBeGreaterThan(0);
    expect(
      state.withOverall,
      "every row should carry an overall"
    ).toBeGreaterThan(0);
    expect(
      state.cards["BELOW 75% OVERALL"],
      `badged rows (${state.flagged}) should match the overall card; got ${JSON.stringify(state.cards)}`
    ).toBe(String(state.flagged));
    expect(state.cards["OVERALL CLASS AVERAGE"]).toMatch(/\d/);
    const selection = page
      .locator("p")
      .filter({ hasText: /^Course:/ })
      .first();
    await expect(selection).toContainText("Subject: All subjects");
    expect(
      problems,
      `no uncaught errors; got ${JSON.stringify(problems)}`
    ).toHaveLength(0);
  });
  test("every path reaches a screen, and a signed-in one does not loop", async ({
    page,
  }) => {
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
      await (path === "/profile"
        ? expect(page.getByRole("heading", { name: "Profile" })).toBeVisible({
            timeout: 90_000,
          })
        : expect(page.getByRole("combobox", { name: "Subject" })).toBeEnabled({
            timeout: 90_000,
          }));
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
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
  });
  test("the click is the only way a register is ever fetched", async ({
    page,
  }) => {
    const registerCalls: unknown[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/register") && r.method() === "POST") {
        registerCalls.push(r.postData());
      }
    });
    await page.goto("/dashboard");
    await submitSignIn(page);
    expect(registerCalls, "the cascade must not fetch a register").toHaveLength(
      0
    );
    await expect(page.locator("tbody tr")).toHaveCount(0);
    const subjectText = await loadFirstSubject(page);
    expect(registerCalls, "one click, one request").toHaveLength(1);
    await expect(
      page.locator("p").filter({ hasText: /^Course:/ })
    ).toContainText(`Subject: ${subjectText}`);
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
    await signInAndLoad(page);
    const total = await page.locator("tbody tr").count();
    expect(total).toBeGreaterThan(0);
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === "ecap_sid");
    expect(sid, "sign-in should set ecap_sid").toBeTruthy();
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
    await expect(page.getByRole("alert")).toHaveCount(0);
    await submitSignIn(page);
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await loadFirstSubject(page);
    await expect(
      page.getByLabel("Show only irregular students")
    ).not.toBeChecked();
    await expect(page.locator("tbody tr")).toHaveCount(total);
  });
  test("a session that dies while you are working says so, and why", async ({
    page,
    request,
  }) => {
    await signInAndLoad(page);
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === "ecap_sid");
    expect(sid, "signed in, so there is a session cookie").toBeTruthy();
    await request.post("/api/logout", {
      headers: { cookie: `ecap_sid=${sid?.value}` },
    });
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange"))
    );
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(/session expired/i);
  });
  test("a sign-out reaches the vault, so a restart cannot undo it", async ({
    page,
    request,
  }) => {
    await signInAndLoad(page);
    const before = vaultSessions();
    test.skip(before === null, "no OS vault on this runtime");
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
    const aged = Math.floor(Date.now() / 1000) + 60;
    await page.context().clearCookies();
    await page
      .context()
      .addCookies([
        { url: baseURL ?? "", name: "ecap_sid", value, expires: aged },
      ]);
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
