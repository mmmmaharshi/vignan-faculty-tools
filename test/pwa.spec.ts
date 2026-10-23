import { test, expect } from "@playwright/test";

/*
 * The installable shell, with no credentials. The manifest carries what the
 * install prompt needs; the service worker owns the shell and must never own
 * an API answer — a cached attendance read would show stale numbers, and a
 * cached session reply could revive a dead session.
 */
test.describe("the installable shell", () => {
  test("the manifest states everything the install prompt needs", async ({
    request,
  }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok(), "the manifest is served").toBe(true);
    const manifest = (await res.json()) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      icons?: { src: string; sizes: string }[];
    };
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    // Every icon the manifest names is actually served.
    for (const icon of manifest.icons ?? []) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.ok(), `${icon.src} is served`).toBe(true);
    }
  });

  test("the service worker takes the page and never an API answer", async ({
    page,
  }) => {
    await page.goto("/");
    // The first navigation predates the worker; the claim below takes the
    // open page, and the reload is the navigation the worker actually owns.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => navigator.serviceWorker.controller?.scriptURL ?? ""
          ),
        { message: "the service worker controls the page", timeout: 15_000 }
      )
      .toContain("/sw.js");
    await page.reload();
    // Signed out, the boot read answers first and the guard lands on /login:
    // by now /api/session has completed, so a worker with ambitions would be
    // holding it, and the reloaded document must sit in its cache — otherwise
    // "no /api entries" proves nothing.
    await expect
      .poll(() => page.url(), {
        message: "the boot read settled and the guard sent on the login form",
        timeout: 15_000,
      })
      .toContain("/login");
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const entry of await cache.keys()) urls.push(entry.url);
      }
      return urls;
    });
    const paths = cached.map((url) => new URL(url).pathname);
    // The navigation the worker actually owned is the current one: the reload
    // fetches the address bar, and the guard had already sent it to /login.
    expect(paths).toContain(new URL(page.url()).pathname);
    expect(
      paths.filter((path) => path.startsWith("/api/")),
      "no API answer sits in any cache"
    ).toEqual([]);
  });

  test("an offline navigation falls back to the offline page", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect
      .poll(
        () =>
          page.evaluate(
            () => navigator.serviceWorker.controller?.scriptURL ?? ""
          ),
        { message: "the service worker controls the page", timeout: 15_000 }
      )
      .toContain("/sw.js");
    await page.reload();
    await expect
      .poll(() => page.url(), {
        message: "the boot read settled and the guard sent on the login form",
        timeout: 15_000,
      })
      .toContain("/login");
    // Installed and warm: the shell, the login document and the offline page
    // are all cached before the connection drops.
    await context.setOffline(true);
    await page.goto("/dashboard");
    await expect(page.getByText("You're offline")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    await context.setOffline(false);
  });
});
