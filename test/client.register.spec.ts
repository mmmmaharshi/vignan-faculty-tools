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

  test("a sign-in settles the whole cascade, one pass per level", async ({
    page,
  }) => {
    await signInAndSettle(page);
    expect(
      {
        course: await selectValue(page, "Course"),
        semester: await selectValue(page, "Semester"),
        branch: await selectValue(page, "Branch"),
        section: await selectValue(page, "Section"),
        subject: await selectValue(page, "Subject"),
      },
      "every level filled itself, in order"
    ).toEqual({
      course: "B.Tech",
      semester: "III Semester",
      branch: "Information Technology",
      section: "IT-3A",
      subject: "ALL SUBJECTS",
    });
    expect(state.optionsCalls, "a pass per level, and no more").toBe(5);
    expect(state.registerCalls, "and no register until the click").toBe(0);
  });

  test("a course read that fails twice is retried from the picker, not a reload", async ({
    page,
  }) => {
    state.optionsFailCount = 2;
    await page.goto("/login");
    await signIn(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      page.getByText("ECAP did not answer the course list", { exact: false })
    ).toBeVisible({ timeout: 15_000 });
    // No course means no level to change, so without its own button the
    // picker would sit in this error until a reload.
    await page.getByRole("button", { name: "Try again" }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
  });

  test("a branch read that fails keeps the courses on screen", async ({
    page,
  }) => {
    state.optionsFailAfterFirst = true;
    await page.goto("/login");
    await signIn(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect(
      page.getByText("ECAP rejected the", { exact: false })
    ).toBeVisible({ timeout: 15_000 });
    expect(
      await selectValue(page, "Course"),
      "the courses arrived on pass 1 and stay beside the error"
    ).toBe("B.Tech");
    expect(
      await selectValue(page, "Branch"),
      "nothing below the failed pass is shown"
    ).toBe("");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("the click is what fetches a register, every time it is clicked", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    // The register is the headed table; the facts tables above it and in the
    // panel have bodies only, so an unscoped row count would include them.
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    expect(state.registerCalls, "one click, one fetch").toBe(1);
    await expect(
      page.getByRole("row", { name: "Subject ALL SUBJECTS" }),
      "the card names the register it shows"
    ).toBeVisible();
    await expect(
      page.getByRole("row", {
        name: "Date Range 01/07/2026 to 16/10/2026",
      }),
      "the range names the window the class report covered, not the probe's day"
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: "Sem Start Date 05/08/2026" }),
      "the probe's day is the start, on its own row"
    ).toBeVisible();
    // The class report states no count either, so the range stays bare — the
    // probed day names the start but no frame count travels with it.
    await expect(page.getByText("days)")).toHaveCount(0);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect.poll(() => state.registerCalls, { timeout: 15_000 }).toBe(2);
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
    expect(state.optionsCalls, "and the click asked for no options").toBe(5);
  });

  test("the overall column sits next to the name, and the roll column sticks", async ({
    page,
  }) => {
    // Narrow enough that the subject columns overflow: stickiness only
    // means anything once there is somewhere to scroll to.
    await page.setViewportSize({ width: 500, height: 800 });
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    const heads = page.locator("thead th");
    expect(await heads.nth(1).innerText(), "second column").toBe("Roll No");
    expect(await heads.nth(2).innerText(), "third column").toBe("Student Name");
    // The overall figure is the triage number: it reads beside the name,
    // not after every subject column.
    expect(await heads.nth(3).innerText(), "fourth column").toBe(
      "Overall Attendance %"
    );
    // The roll column stays put while the subjects scroll away beneath it.
    const sticky = await heads.nth(1).evaluate((element) => {
      const css = getComputedStyle(element);
      return { position: css.position, left: css.left };
    });
    expect(sticky, "Roll No header sticks to the scroll edge").toEqual({
      position: "sticky",
      left: "0px",
    });
    const firstRoll = page
      .locator("thead ~ tbody tr")
      .first()
      .locator("td")
      .nth(1);
    expect(
      await firstRoll.evaluate((element) => getComputedStyle(element).position),
      "Roll No cells stick with their header"
    ).toBe("sticky");
    // Opaque, in the row's own colour: the first body row is an odd row,
    // so its stuck cell carries the table's stripe, and sliding columns
    // hide beneath it instead of ghosting through. The row itself is the
    // second witness: it must paint the same stripe, which is what proves
    // the parity is Mantine's own rendering, not just code agreeing
    // with test.
    expect(
      await firstRoll.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      ),
      "first row's stuck cell paints the stripe"
    ).toBe("rgb(248, 249, 250)");
    expect(
      await page
        .locator("thead ~ tbody tr")
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "the row itself stripes the same colour"
    ).toBe("rgb(248, 249, 250)");
    const scrolled = await heads.nth(1).evaluate((cell) => {
      // The true scroller is Mantine's ScrollArea viewport: an overflow
      // ancestor with scrolling enabled, not merely an overflowing box
      // (the content div overflows but never scrolls).
      let scroller: HTMLElement | null = cell.parentElement;
      while (scroller) {
        const horizontal = getComputedStyle(scroller).overflowX;
        if (
          (horizontal === "auto" || horizontal === "scroll") &&
          scroller.scrollWidth > scroller.clientWidth + 1
        ) {
          break;
        }
        scroller = scroller.parentElement;
      }
      if (!scroller) return null;
      scroller.scrollLeft = scroller.scrollWidth;
      const cellLeft = cell.getBoundingClientRect().left;
      const edgeLeft = scroller.getBoundingClientRect().left;
      return Math.abs(cellLeft - edgeLeft);
    });
    expect(
      scrolled,
      "Roll No stays at the scroll edge after scrolling away"
    ).toBeLessThan(3);
  });

  test("typing in the search box narrows the register to matches", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    const box = page.getByLabel("Search students by name or roll number");
    await box.fill("21b");
    // The stub's rolls are 21A, 21B, 21C: one row carries that fragment, and
    // the match cannot care that it was typed lower-case.
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(1);
    expect(
      state.registerCalls,
      "filtering reads no portal, it reads the rows"
    ).toBe(1);
    await box.fill("");
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
  });

  test("a search typed for one class goes when the next register loads", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    const box = page.getByLabel("Search students by name or roll number");
    await box.fill("nobody");
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(0);
    await page.getByRole("button", { name: "Load register" }).click();
    // The next register is not the one that name was typed for: a search left
    // behind would hide every row of it with nothing on screen to explain it.
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(box).toHaveValue("");
  });

  test("ticked bars narrow the register, and unticking restores it", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    // Overall figures on the stub: 81, 52, 30. Below 65 keeps two of them.
    await page.getByLabel("Below 65%").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(2);
    await expect(page.getByText("lowest attendance first")).toBeVisible();
    // Below 75 keeps the same two here; ticking it changes nothing further.
    await page.getByLabel("Below 75%").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(2);
    await page.getByLabel("Below 65%").click();
    await page.getByLabel("Below 75%").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
    // The irregular box reads bands, not figures: B and C are flagged.
    await page.getByLabel("All irregular students").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(2);
    await page.getByLabel("All irregular students").click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
  });

  test("a subject register shows subject and overall figures side by side", async ({
    page,
  }) => {
    // The register states its own start, so the snapped window is the whole
    // semester: the window's dates arrive as the one full-semester list.
    state.statedFrom = "01/07/2026";
    await signInAndSettle(page);
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("columnheader", { name: "Subject Attendance %" })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Overall Attendance %" }),
      "on a subject register the overall column reads beside the name too"
    ).toBeVisible();
    const heads = page.locator("thead th");
    expect(
      await heads.evaluateAll((elements) =>
        elements.map((element) => element.textContent?.trim())
      ),
      "Name, Overall, then the subject's own columns"
    ).toEqual([
      "Sl.No",
      "Roll No",
      "Student Name",
      "Overall Attendance %",
      "Attend / Held",
      "Subject Attendance %",
      "Details",
    ]);
    await expect(
      page.getByText("52.00%", { exact: true }),
      "B student's overall beside their 44.40% subject figure"
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: "Subject MFCS" }),
      "the card names the subject register it shows"
    ).toBeVisible();
    await expect(
      page.getByRole("row", {
        name: "Date Range (108 days) 01/07/2026 to 16/10/2026",
      }),
      "the range carries the calendar-day frame"
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Show details for B student" })
      .click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByText("Subject attendance", { exact: true })
    ).toBeVisible();
    await expect(
      panel.getByText("Overall attendance", { exact: true }),
      "the panel shows both figures, like the table"
    ).toBeVisible();
    await expect(
      panel.getByText("Date Range", { exact: false }),
      "the facts table above the register belongs to the register, not the panel"
    ).toHaveCount(0);
    await expect(
      panel.getByText("Absent — full semester, this subject (1)", {
        exact: true,
      }),
      "one list, holding the window's own dates as the semester's"
    ).toBeVisible();
    await expect(
      panel.getByText("12/10", { exact: true }),
      "absence dates are read from the register's own columns, five to a row"
    ).toBeVisible();
    await expect(
      panel.getByText("Backlogs", { exact: true }),
      "the backlogs the profile states are on the panel"
    ).toBeVisible();
    await expect(
      panel.getByRole("row", { name: /I Semester.*Com\.Eng/ }),
      "under the semester ECAP names them by"
    ).toBeVisible();
    await expect(
      panel.getByText("*EP", { exact: true }),
      "with the subject codes it lists, the marked one keeping its asterisk"
    ).toBeVisible();
    await expect(
      panel.getByText("Com.Eng", { exact: true }),
      "every one of them"
    ).toBeVisible();
    await expect(
      panel.getByRole("row", { name: "Total backlogs 2" }),
      "and the page's own total, as it states it"
    ).toBeVisible();
  });

  test("the All subjects view states each subject's own percentage", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole("checkbox", { name: "All irregular students (2)" })
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Below 75% (2)" })
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Below 65% (2)" })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "MFCS" })
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "WT TEST" })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "A Student", exact: true }),
      "names print capitalised, not as ECAP shouts them"
    ).toBeVisible();
    expect(
      await page
        .getByRole("columnheader", { name: "WT TEST" })
        .locator("span")
        .evaluate((el) => getComputedStyle(el).whiteSpace),
      "subject headers never wrap onto a second line"
    ).toBe("nowrap");
    expect(
      await page
        .getByRole("columnheader", { name: "WT TEST" })
        .evaluate((el) => getComputedStyle(el).textAlign),
      "figure headers are centered"
    ).toBe("center");
    expect(
      await page
        .getByRole("columnheader", { name: "Overall Attendance %" })
        .evaluate((el) => getComputedStyle(el).textAlign),
      "the overall header matches"
    ).toBe("center");
    expect(
      await page
        .getByRole("columnheader", { name: "Overall Attendance %" })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "the overall columns sit on their own tint"
    ).not.toBe(
      await page
        .getByRole("columnheader", { name: "MFCS" })
        .evaluate((el) => getComputedStyle(el).backgroundColor)
    );
    await expect(
      page.getByRole("cell", { name: "90.00%", exact: true }),
      "A student's MFCS percentage, exactly as ECAP stated it"
    ).toBeVisible();
    expect(
      await page
        .getByRole("cell", { name: "90.00%", exact: true })
        .evaluate((el) => getComputedStyle(el).textAlign),
      "figure cells are centered"
    ).toBe("center");
    expect(
      await page
        .getByRole("cell", { name: "90.00%", exact: true })
        .evaluate((el) => getComputedStyle(el).borderLeftWidth),
      "columns are divided by full borders"
    ).not.toBe("0px");
    await expect(
      page.getByRole("cell", { name: "—", exact: true }),
      "a subject the portal left blank is a dash, not a zero"
    ).toHaveCount(2, { timeout: 15_000 });
    await expect(
      page.getByRole("columnheader", { name: "Subject Attendance %" }),
      "no subject figure on the section view"
    ).toHaveCount(0);
  });

  test("a subject header ticks a threshold for its own column", async ({
    page,
  }) => {
    // Stub figures: A [90, 80], B [70, no SE], C [50, no SE].
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "MFCS", exact: true }).click();
    await expect(
      page.getByRole("columnheader", { name: "MFCS <75%", exact: true })
    ).toBeVisible();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "MFCS <75%", exact: true }).click();
    await expect(
      page.getByRole("columnheader", { name: "MFCS <65%", exact: true })
    ).toBeVisible();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "MFCS <65%", exact: true }).click();
    await expect(
      page.getByRole("columnheader", { name: "MFCS", exact: true })
    ).toBeVisible();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
  });

  test("an empty subject worklist can still clear its bar", async ({
    page,
  }) => {
    // WT TEST <75% keeps nobody: A is at 80, B and C state nothing for WT
    // TEST. The table is gone with its headers, so the way back out sits
    // beside the empty sentence rather than in a header that is no longer
    // there.
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "WT TEST", exact: true }).click();
    await expect(
      page.getByText("No students below 75% in WT TEST.", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear subject filters" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3);
  });

  test("a fully chosen class is remembered when Load register is clicked", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.evaluate(() => localStorage.removeItem("section-faculty"));
    await signIn(page);
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await expect
      .poll(() => selectValue(page, "Subject"), { timeout: 15_000 })
      .toBe("ALL SUBJECTS");
    await page.getByRole("combobox", { name: "Subject" }).click();
    await page.getByRole("option", { name: "MFCS", exact: true }).click();
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(
      page.getByRole("heading", { name: "Saved classes" }),
      "the card appears once the register is loaded"
    ).toBeVisible({ timeout: 5000 });
  });
});
