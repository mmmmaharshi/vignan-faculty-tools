import { expect, test } from "@playwright/test";
import type { JSHandle, Locator, Page } from "@playwright/test";

import {
  hold,
  releaseProfile,
  resetStub,
  signInAndSettle,
  stub,
} from "./support/client-stub";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

type Gesture = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

const beginSwipe = async (
  surface: Locator,
  dx: number,
  dy: number,
  atEdge = false
): Promise<Gesture> =>
  surface.evaluate(
    (element, delta) => {
      const rect = element.getBoundingClientRect();
      const startX = delta.atEdge
        ? Math.min(5, rect.left + 2)
        : rect.left + Math.min(120, rect.width / 2);
      const startY = rect.top + rect.height / 2;
      const start = new Touch({
        identifier: 1,
        target: element,
        clientX: startX,
        clientY: startY,
        screenX: startX,
        screenY: startY,
        pageX: startX,
        pageY: startY,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      });
      const touchStart = new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
        touches: [start],
        targetTouches: [start],
        changedTouches: [start],
      });
      element.dispatchEvent(touchStart);
      return {
        startX,
        startY,
        endX: startX + delta.dx,
        endY: startY + delta.dy,
      };
    },
    { dx, dy, atEdge }
  );

const finishSwipe = async (
  surface: Locator,
  gesture: Gesture
): Promise<boolean> =>
  surface.evaluate((element, delta) => {
    const end = new Touch({
      identifier: 1,
      target: element,
      clientX: delta.endX,
      clientY: delta.endY,
      screenX: delta.endX,
      screenY: delta.endY,
      pageX: delta.endX,
      pageY: delta.endY,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    });
    const move = new TouchEvent("touchmove", {
      bubbles: true,
      cancelable: true,
      touches: [end],
      targetTouches: [end],
      changedTouches: [end],
    });
    element.dispatchEvent(move);
    element.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        touches: [],
        targetTouches: [],
        changedTouches: [end],
      })
    );
    return move.defaultPrevented;
  }, gesture);

type Box = { x: number; y: number; width: number; height: number };

const nativeSwipe = async (
  page: Page,
  box: Box,
  dx: number,
  dy: number,
  atEdge = false
): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  const startX = atEdge ? Math.min(24, box.x + 24) : box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y: startY }],
    });
    for (let step = 1; step <= 4; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: startX + (dx * step) / 4,
            y: startY + (dy * step) / 4,
          },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await cdp.detach();
  }
};

const swipe = async (
  surface: Locator,
  dx: number,
  dy: number
): Promise<{ movePrevented: boolean }> => {
  const gesture = await beginSwipe(surface, dx, dy);
  return { movePrevented: await finishSwipe(surface, gesture) };
};

const swipeLeft = (surface: Locator): Promise<{ movePrevented: boolean }> =>
  swipe(surface, -180, 0);

const interruptWithSecondTouch = async (
  surface: Locator,
  gesture: Gesture
): Promise<void> =>
  surface.evaluate((element, delta) => {
    const touch = (identifier: number, clientX: number, clientY: number) =>
      new Touch({
        identifier,
        target: element,
        clientX,
        clientY,
        screenX: clientX,
        screenY: clientY,
        pageX: clientX,
        pageY: clientY,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      });
    const first = touch(1, delta.endX, delta.endY);
    const second = touch(2, delta.startX + 40, delta.startY + 40);
    element.dispatchEvent(
      new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [first, second],
        targetTouches: [first, second],
        changedTouches: [first, second],
      })
    );
    element.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        touches: [second],
        targetTouches: [second],
        changedTouches: [first],
      })
    );
  }, gesture);

const openDrawer = async (page: Page): Promise<Locator> => {
  await signInAndSettle(page);
  await page.getByRole("button", { name: "Load register" }).click();
  await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
    timeout: 15_000,
  });
  await page
    .getByRole("button", { name: "Show details for B student" })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("CGPA 5.61")).toBeVisible({
    timeout: 15_000,
  });
  await expect(drawer).toHaveCSS("overscroll-behavior-x", "none");
  return drawer;
};

const expectDrawerOpen = async (drawer: Locator): Promise<void> => {
  await expect
    .poll(() => drawer.evaluate((element) => element.getAnimations().length), {
      timeout: 2000,
    })
    .toBe(0);
  expect(await drawer.count(), "the drawer remains open").toBe(1);
  await expect(drawer).toBeVisible();
};

const scrollableAncestor = async (surface: Locator, axis: "x" | "y") =>
  surface.evaluateHandle((element, direction) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const overflow = direction === "x" ? style.overflowX : style.overflowY;
      const scrollSize =
        direction === "x" ? node.scrollWidth : node.scrollHeight;
      const clientSize =
        direction === "x" ? node.clientWidth : node.clientHeight;
      if (
        (overflow === "auto" || overflow === "scroll") &&
        scrollSize > clientSize + 1
      ) {
        return node;
      }
    }
    throw new Error(`No ${direction}-axis scroll container found`);
  }, axis);

const boxOf = async (handle: JSHandle<Element>): Promise<Box> =>
  handle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

test.describe("the mobile student drawer", () => {
  test.beforeEach(async ({ page }) => {
    resetStub();
    await page.route("**/api/**", stub);
  });

  test("a left swipe closes the drawer without navigating back", async ({
    page,
  }) => {
    const drawer = await openDrawer(page);
    const path = new URL(page.url()).pathname;
    const historyLength = await page.evaluate(() => window.history.length);

    const result = await swipeLeft(drawer.getByText("CGPA 5.61"));
    expect(result.movePrevented, "the browser back gesture is canceled").toBe(
      true
    );
    await expect(drawer).toBeHidden({ timeout: 2000 });
    expect(new URL(page.url()).pathname, "the register stays on screen").toBe(
      path
    );
    expect(
      await page.evaluate(() => window.history.length),
      "closing the drawer adds no history entry"
    ).toBe(historyLength);
  });

  test("the drawer contains horizontal overscroll and keeps pinch zoom", async ({
    page,
  }) => {
    const drawer = await openDrawer(page);
    await expect(drawer).toHaveCSS("overscroll-behavior-x", "none");
    const touchAction = await drawer.evaluate(
      (element) => getComputedStyle(element).touchAction
    );
    expect(["auto", "manipulation"]).toContain(touchAction);
    const gesture = await beginSwipe(drawer, -180, 0, true);
    await finishSwipe(drawer, gesture);
    await expect(drawer).toBeHidden({ timeout: 2000 });
  });

  test("a native edge swipe closes without changing history", async ({
    page,
  }) => {
    const drawer = await openDrawer(page);
    const path = new URL(page.url()).pathname;
    const historyLength = await page.evaluate(() => window.history.length);
    const surface = await drawer.evaluateHandle((element) => element);
    await expectDrawerOpen(drawer);
    const box = await boxOf(surface);
    await nativeSwipe(page, box, -180, 0, true);
    await expect(drawer).toBeHidden({ timeout: 2000 });
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await page.evaluate(() => window.history.length)).toBe(
      historyLength
    );
    await surface.dispose();
  });

  test("the register behind the drawer does not scroll", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 600 });
    const drawer = await openDrawer(page);
    const before = await page.evaluate(() => window.scrollY);
    expect(
      await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0)
    ).toBeGreaterThan(600);
    await page.mouse.move(50, 300);
    await page.mouse.wheel(0, 500);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await expect(drawer).toBeVisible();
  });

  test("a vertical swipe from the left edge still scrolls", async ({
    page,
  }) => {
    const drawer = await openDrawer(page);
    await expectDrawerOpen(drawer);
    const body = await drawer.evaluateHandle((element) => element);
    const box = await boxOf(body);
    await nativeSwipe(page, box, 0, -180, true);
    expect(
      await body.evaluate((element) => element.scrollTop),
      "the vertical swipe scrolls the drawer"
    ).toBeGreaterThan(0);
    await body.dispose();
    await expectDrawerOpen(drawer);
  });

  test("a left swipe at the start of the month table closes the drawer", async ({
    page,
  }) => {
    const drawer = await openDrawer(page);
    const result = await swipeLeft(
      drawer.getByText("05/08/2026 to 31/08/2026")
    );
    expect(result.movePrevented, "the table cannot scroll farther left").toBe(
      true
    );
    await expect(drawer).toBeHidden({ timeout: 2000 });
  });

  test("a left swipe inside a scrolled month table scrolls it without closing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const drawer = await openDrawer(page);
    const scroller = await scrollableAncestor(
      drawer.getByText("05/08/2026 to 31/08/2026"),
      "x"
    );
    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const before = await scroller.evaluate((element) => element.scrollLeft);
    const box = await boxOf(scroller);
    await nativeSwipe(page, box, -160, 0);
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft), {
        timeout: 2000,
      })
      .toBeLessThan(before);
    await scroller.dispose();
    await expectDrawerOpen(drawer);
  });

  test("a rightward swipe inside a scrolled month table scrolls back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    const drawer = await openDrawer(page);
    const path = new URL(page.url()).pathname;
    const historyLength = await page.evaluate(() => window.history.length);
    const scroller = await scrollableAncestor(
      drawer.getByText("05/08/2026 to 31/08/2026"),
      "x"
    );
    await scroller.evaluate((element) => {
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
    });
    const before = await scroller.evaluate((element) => element.scrollLeft);
    const box = await boxOf(scroller);
    await nativeSwipe(page, box, 160, 0);
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft), {
        timeout: 2000,
      })
      .toBeGreaterThan(before);
    await scroller.dispose();
    await expectDrawerOpen(drawer);
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await page.evaluate(() => window.history.length)).toBe(
      historyLength
    );
  });

  test("a profile answer mid-swipe does not detach the gesture", async ({
    page,
  }) => {
    await signInAndSettle(page);
    await page.getByRole("button", { name: "Load register" }).click();
    await expect(page.locator("thead ~ tbody tr")).toHaveCount(3, {
      timeout: 15_000,
    });
    hold("profile");
    await page
      .getByRole("button", { name: "Show details for B student" })
      .click();
    const drawer = page.getByRole("dialog");
    const surface = drawer.getByText("Overall attendance");
    await expect(surface).toBeVisible();
    await expect(drawer).toHaveCSS("overscroll-behavior-x", "none");
    const gesture = await beginSwipe(surface, -180, 0);
    await releaseProfile();
    await expect(drawer.getByText("CGPA 5.61")).toBeVisible({
      timeout: 15_000,
    });
    expect(await finishSwipe(surface, gesture)).toBe(true);
    await expect(drawer).toBeHidden({ timeout: 2000 });
  });

  test("a second touch cancels the swipe instead of closing the drawer", async ({
    page,
  }) => {
    const drawer = await openDrawer(page);
    const surface = drawer.getByText("CGPA 5.61");
    const gesture = await beginSwipe(surface, -180, 0);
    await interruptWithSecondTouch(surface, gesture);
    await expectDrawerOpen(drawer);
  });
});
