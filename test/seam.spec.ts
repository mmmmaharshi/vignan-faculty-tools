import { test, expect } from "@playwright/test";

import {
  level,
  looksLikeHtml,
  options,
  parseClassAttendance,
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
const SELECT_ONLY_PLACEHOLDER = `<select><option value="-Select-">-Select-</option></select>`;
test.describe("portal replies", () => {
  test("a dead session's markup is told apart from real data", () => {
    expect(looksLikeHtml(LOGIN_PAGE)).toBe(true);
    expect(looksLikeHtml('  <html lang="en">')).toBe(true);
    expect(
      looksLikeHtml("'<select><option value=\"1\">B.Tech</option></select>'")
    ).toBe(false);
    expect(looksLikeHtml('{"value":"<table></table>"}')).toBe(false);
    expect(looksLikeHtml("<option value='1'>B.Tech</option>")).toBe(false);
  });
  test("unquoteJs always hands back a string", () => {
    expect(unquoteJs("'<b>hi</b>'")).toBe("<b>hi</b>");
    expect(unquoteJs('{"value":"<table></table>"}')).toBe("<table></table>");
    expect(unquoteJs('{"d":"<table></table>"}')).toBe("<table></table>");
    expect(unquoteJs("{value:'<table></table>'}")).toBe(
      "{value:'<table></table>'}"
    );
    expect(typeof unquoteJs('{"value":42}')).toBe("string");
    expect(unquoteJs('{"value":42}')).toBe('{"value":42}');
    expect(typeof unquoteJs('{"error":"nope"}')).toBe("string");
    expect(unquoteJs("")).toBe("");
    expect(unquoteJs("'a\\'b'")).toBe("a'b");
  });
  test("options drops placeholders and entries with no identifier", () => {
    const all = options(SELECT);
    expect(all.map((o) => o.value)).toEqual(["-Select-", "1", "2"]);
    expect(realOptions(all).map((o) => o.value)).toEqual(["1", "2"]);
    expect(realOptions(all).map((o) => o.label)).toEqual(["B.Tech", "M.Tech"]);
    expect(all[1]?.title).toBe("2024");
    expect(all[2]?.title).toBe("");
    expect(options(undefined)).toEqual([]);
    expect(options(null)).toEqual([]);
    expect(options("<p>no selects here</p>")).toEqual([]);
  });
  test("level reports an empty list instead of blocking on it", () => {
    const real = realOptions(options(SELECT));
    const ok = level(real);
    expect(ok.empty).toBe(false);
    expect(ok.choices).toBe(real);
    const empty = level([]);
    expect(empty.empty).toBe(true);
    expect(empty.choices).toEqual([]);
    expect(level(realOptions(options(SELECT_ONLY_PLACEHOLDER))).empty).toBe(
      true
    );
  });
  test("parseRegister keeps a student whose percentage will not parse", () => {
    const html = `<table>
      <tr><th>Sl.No</th><th>Roll No</th><th>Student Name</th><th>Attend/Held</th><th>%</th></tr>
      <tr><td>1</td><td>21CS001</td><td>Asha Rao</td><td>38/45</td><td>84.44</td></tr>
      <tr><td>2</td><td>21CS002</td><td>Bimal Shah</td><td>20/45</td><td>n/a</td></tr>
      <tr><td>3</td><td>21CS003</td><td>Chitra Iyer</td><td>45/45</td><td>100.00</td></tr>
    </table>`;
    const rows = parseRegister(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      roll: "21CS001",
      name: "Asha Rao",
      attendedOfHeld: "38/45",
      pct: 84.44,
    });
    expect(rows[1]?.pct).toBeNull();
    expect(rows[2]?.pct).toBe(100);
    expect(rows[0]?.attendedOfHeld).toBe("38/45");
    expect(parseRegister(LOGIN_PAGE)).toEqual([]);
    expect(
      parseRegister("<table><tr><th>Something else</th></tr></table>")
    ).toEqual([]);
  });
  test("the class report is read from the portal's own last two cells", () => {
    const html = `<center><div id='tblReport'><table width='95%'>
      <tr><td>Course</td><td>:</td><td>B.Tech</td></tr>
      <tr><td>ATTENDANCE REPORT FOR THE PERIOD OF 01/06/2026 - 29/09/2026</td></tr>
      <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>AI</th><th>DWDM</th><th>Total</th><th>Percent</th></tr>
      <tr><td>Batch-1</td><td>50</td><td>0</td><td>49</td><td>-</td><td></td><td></td></tr>
      <tr><td>1</td><td>24L31A1201</td><td>ADARI LASYA SHREE</td><td>37</td><td>-</td><td>381\\481</td><td>79.21</td></tr>
      <tr><td>2</td><td>24L31A1202</td><td>ANOTHER STUDENT</td><td>35</td><td>10</td><td>356\\481</td><td>74.01</td></tr>
      <tr><td>3</td><td>24L31A1203</td><td>NO PERCENTAGE</td><td>10</td><td>10</td><td>20\\30</td><td></td></tr>
    </table></div></center>`;
    const rows = parseClassAttendance(html);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      sl: "1",
      roll: "24L31A1201",
      name: "ADARI LASYA SHREE",
      attendedOfHeld: "381\\481",
      pct: 79.21,
    });
    expect(rows[1]).toMatchObject({ roll: "24L31A1202", pct: 74.01 });
    expect(rows[2]?.pct).toBeNull();
    expect(rows[2]?.attendedOfHeld).toBe("20\\30");
  });
  test("the class report's held band and title block are not students", () => {
    const html = `<table>
      <tr><th>Sl.No</th><th>Roll.No</th><th>Student Name</th><th>Total</th><th>Percent</th></tr>
      <tr><td>Batch-1</td><td>50</td><td>0</td><td></td><td></td></tr>
      <tr><td>1</td><td>24L31A1201</td><td>ONLY STUDENT</td><td>381\\481</td><td>79.21</td></tr>
      <tr><td>Total</td><td>69</td><td>count</td><td></td><td></td></tr>
    </table>`;
    const rows = parseClassAttendance(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roll).toBe("24L31A1201");
  });
  test("markup with no roll-number header yields no students at all", () => {
    expect(parseClassAttendance(LOGIN_PAGE)).toEqual([]);
    expect(
      parseClassAttendance("<table><tr><th>Subject</th></tr></table>")
    ).toEqual([]);
    expect(parseClassAttendance("")).toEqual([]);
  });
});
