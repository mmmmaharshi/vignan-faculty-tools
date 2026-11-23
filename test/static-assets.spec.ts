import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { test, expect } from "@playwright/test";

import { acceptsGzip, compressedAsset } from "../server/compressed-assets";
import { resetStub, stub } from "./support/client-stub";

/** A real file on disk: `compressedAsset` reads the bytes itself, so a
 *  fixture keeps the whole path — compressibility, caching and headers. */
function fixture(name: string, bytes: Uint8Array): string {
  const dir = mkdtempSync(path.join(tmpdir(), "compressed-"));
  const full = path.join(dir, name);
  writeFileSync(full, bytes);
  test.info().annotations.push({ type: "cleanup", description: dir });
  return full;
}
test.afterEach(() => {
  for (const { description: dir } of test.info().annotations) {
    rmSync(String(dir), { recursive: true, force: true });
  }
});

test.describe("compressed static assets", () => {
  test("gzip is named case-insensitively, with or without q-values", () => {
    expect(acceptsGzip("gzip, deflate, br")).toBe(true);
    expect(acceptsGzip("GZIP;q=1.0")).toBe(true);
    expect(acceptsGzip("br, deflate")).toBe(false);
    expect(acceptsGzip(null)).toBe(false);
  });
  test("a compressible asset round-trips through gzip with its headers", async () => {
    const body = Buffer.from(`var x = ${"0".repeat(4000)};\n`);
    const full = fixture("app-abc123.js", body);
    const headers = { "content-type": "text/javascript", "cache-control": "x" };
    const res = await compressedAsset(
      full,
      "/assets/app-abc123.js",
      "gzip",
      headers
    );
    expect(res).not.toBeNull();
    expect(res?.headers.get("content-encoding")).toBe("gzip");
    expect(res?.headers.get("vary")).toBe("Accept-Encoding");
    expect(res?.headers.get("content-type")).toBe("text/javascript");
    expect(res?.headers.get("cache-control")).toBe("x");
    const wire = Buffer.from(await res!.arrayBuffer());
    expect(wire.length).toBeLessThan(body.length);
    expect(Buffer.from(gunzipSync(wire))).toEqual(body);
  });
  test("no gzip accepted, a compressed format, or a tiny file answers null", async () => {
    const big = Buffer.from(`var x = ${"0".repeat(4000)};\n`);
    const full = fixture("app-abc123.js", big);
    await expect(
      compressedAsset(full, "/assets/app-abc123.js", "br", {})
    ).resolves.toBeNull();
    await expect(
      compressedAsset(full, "/assets/icon.png", "gzip", {})
    ).resolves.toBeNull();
    const tiny = fixture("tiny.js", Buffer.from("var x = 1;\n"));
    await expect(
      compressedAsset(tiny, "/assets/tiny.js", "gzip", {})
    ).resolves.toBeNull();
  });
});

/** A reply the server gzipped on the wire: the seam the unit tests cannot
 *  see — they run under Node, while the server answers WHATWG requests. The
 *  query string dodges the worker cache, so the answer is the server's. */
test.describe("compressed static assets over the wire", () => {
  test.beforeEach(async ({ page }) => {
    resetStub();
    await page.route("**/api/**", stub);
  });

  test("a hashed script arrives gzipped, and says so", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("ECAP user name")).toBeVisible();
    const src = await page.evaluate(() => {
      const el = document.querySelector(
        'script[type="module"]'
      ) as HTMLScriptElement | null;
      return el?.getAttribute("src") ?? "";
    });
    expect(src).toMatch(/^\/assets\/index-.*\.js$/);
    const seen = await page.evaluate(async (url) => {
      const res = await fetch(`${url}?probe=${Date.now()}`);
      return {
        encoding: res.headers.get("content-encoding"),
        vary: res.headers.get("vary"),
      };
    }, src);
    expect(seen.encoding, "the server gzips hashed assets").toBe("gzip");
    expect(seen.vary, "caches must not serve it to clients without gzip").toBe(
      "Accept-Encoding"
    );
  });
});
