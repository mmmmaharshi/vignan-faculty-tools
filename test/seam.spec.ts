/**
 * Portal seam: what the app does with what ECAP sent.
 *
 * Every function exercised here is a pure function over a string in
 * `portal-replies.ts` - no network, no session, no credentials. That is the
 * whole reason they were moved out of `server.ts`: importing that file boots a
 * server, so nothing in it could be tested without one. These run in
 * milliseconds against fixture markup, and they run whether or not ECAP_USER is
 * set, so the project is no longer blind when nobody has credentials to hand.
 *
 * Each test below fails for its own reason, and none of them restates the
 * implementation:
 *
 *  - looksLikeHtml separates the portal's markup from a dead session's markup.
 *    Getting it backwards sends a real reply to the "session expired" path.
 *  - unquoteJs must hand back a string, because both callers treat the result as
 *    one. The numeric case is where the untyped version used to leak.
 *  - options must drop both a placeholder and an entry with no identifier: the
 *    first is not a choice, the second resolves to nothing while looking chosen.
 *  - expectLevel must raise for an empty list and pass a real one through, and
 *    its message must not blame the thing that is usually innocent.
 *  - parseRegister must keep a row whose percentage will not parse, as null,
 *    rather than dropping the student from every count.
 */

import { test, expect } from "@playwright/test";
import {
  expectLevel,
  HttpError,
  looksLikeHtml,
  options,
  parseRegister,
  realOptions,
  unquoteJs,
} from "../portal-replies";

const SELECT = `<select id="ddlcourse">
  <option value="-Select-">-Select-</option>
  <option value="1" title="2024">B.Tech</option>
  <option value="2" title="">M.Tech</option>
  <option title="3">No identifier here</option>
  <option value="4">   </option>
</select>`;

const LOGIN_PAGE = `<!DOCTYPE html><html><head><title>ECAP</title></head><body>Sign in</body></html>`;

test.describe("portal replies", () => {
  test("a dead session's markup is told apart from real data", () => {
    expect(looksLikeHtml(LOGIN_PAGE)).toBe(true);
    expect(looksLikeHtml("  <html lang=\"en\">")).toBe(true);
    // The two real reply shapes, which must never be mistaken for a page.
    expect(looksLikeHtml("'<select><option value=\"1\">B.Tech</option></select>'")).toBe(false);
    expect(looksLikeHtml('{"value":"<table></table>"}')).toBe(false);
    // A fragment that merely contains a tag is still data.
    expect(looksLikeHtml("<option value='1'>B.Tech</option>")).toBe(false);
  });

  test("unquoteJs always hands back a string", () => {
    // The shape convention B actually uses: a bare quoted string.
    expect(unquoteJs("'<b>hi</b>'")).toBe("<b>hi</b>");
    // The object form, but only as strict JSON. A single-quoted JS literal is
    // not JSON, so JSON.parse rejects it and the raw text is returned - pinned
    // here because it is the difference between unwrapping and not.
    expect(unquoteJs('{"value":"<table></table>"}')).toBe("<table></table>");
    expect(unquoteJs('{"d":"<table></table>"}')).toBe("<table></table>");
    expect(unquoteJs("{value:'<table></table>'}")).toBe("{value:'<table></table>'}");
    // The case the untyped version got wrong: a payload that is not a string
    // came back as a number, and parseRegister then called .match on it.
    expect(typeof unquoteJs('{"value":42}')).toBe("string");
    expect(unquoteJs('{"value":42}')).toBe('{"value":42}');
    expect(typeof unquoteJs('{"error":"nope"}')).toBe("string");
    expect(unquoteJs("")).toBe("");
    // Escapes the portal's enc() pairing leaves behind.
    expect(unquoteJs("'a\\'b'")).toBe("a'b");
  });

  test("options drops placeholders and entries with no identifier", () => {
    const all = options(SELECT);
    // Four <option> tags, but the blank-label one and the valueless one are not
    // choices. The -Select- placeholder survives `options` and is removed by
    // `realOptions`, which is a separate filter at a separate layer.
    expect(all.map((o) => o.value)).toEqual(["-Select-", "1", "2"]);
    expect(realOptions(all).map((o) => o.value)).toEqual(["1", "2"]);
    expect(realOptions(all).map((o) => o.label)).toEqual(["B.Tech", "M.Tech"]);
    // The title is kept because the batch number for the section list lives
    // there, and IV Semester ships an empty one.
    expect(all[1]?.title).toBe("2024");
    expect(all[2]?.title).toBe("");
    // A reply that is not markup at all is an empty list, not a crash.
    expect(options(undefined)).toEqual([]);
    expect(options(null)).toEqual([]);
    expect(options("<p>no selects here</p>")).toEqual([]);
  });

  test("expectLevel raises for an empty level and names both causes", () => {
    const real = realOptions(options(SELECT));
    expect(expectLevel(real, "courses")).toBe(real);

    let caught: unknown;
    try {
      expectLevel([], "courses");
    } catch (e) {
      caught = e;
    }
    expect(caught, "an empty level should raise").toBeInstanceOf(HttpError);
    const err = caught as HttpError;
    expect(err.status).toBe(502);
    // Neither cause is assumed. Naming only the layout change would send the
    // reader looking in the wrong place every time the session had simply died.
    expect(err.message).toContain("layout may have changed");
    expect(err.message).toContain("session may have expired");
    // And it must not blame the level the user can do something about.
    expect(err.message).not.toMatch(/date range/i);
  });

  test("parseRegister keeps a student whose percentage will not parse", () => {
    const html = `<table>
      <tr><th>Sl.No</th><th>Roll No</th><th>Student Name</th><th>Attend/Held</th><th>%</th></tr>
      <tr><td>1</td><td>21CS001</td><td>Asha Rao</td><td>38/45</td><td>84.44</td></tr>
      <tr><td>2</td><td>21CS002</td><td>Bimal Shah</td><td>20/45</td><td>n/a</td></tr>
      <tr><td>3</td><td>21CS003</td><td>Chitra Iyer</td><td>45/45</td><td>100.00</td></tr>
    </table>`;
    const rows = parseRegister(html);
    // Three students in, three out. Dropping the unparseable row would quietly
    // remove a student from the class average and from every flagged count.
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ roll: "21CS001", name: "Asha Rao", attendedOfHeld: "38/45", pct: 84.44 });
    expect(rows[1]?.pct).toBeNull();
    expect(rows[2]?.pct).toBe(100);
    // The combined cell is never split. See CONTEXT.md, "Attended of held".
    expect(rows[0]?.attendedOfHeld).toBe("38/45");

    // A page with no register table is the failure this guards: the route
    // turns it into a 502 that names both causes rather than the date range.
    expect(parseRegister(LOGIN_PAGE)).toEqual([]);
    expect(parseRegister("<table><tr><th>Something else</th></tr></table>")).toEqual([]);
  });
});
